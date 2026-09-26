import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { ApiFault } from '../_shared/fault.js';
import {
  disableResponseCaching,
  header,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '服务配置尚未完成');
  return value;
};

const validCronCredential = (authorization: string | undefined, secret: string): boolean => {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization ?? ''), digest(`Bearer ${secret}`));
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  disableResponseCaching(response);
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    if (!validCronCredential(header(request, 'authorization'), required('CRON_SECRET')))
      throw new ApiFault('FORBIDDEN', '定时任务凭据无效');
    const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const now = new Date().toISOString();
    const { data: due, error } = await client
      .from('account_deletion_requests')
      .select('user_id')
      .eq('status', 'pending')
      .lte('execute_after', now)
      .limit(20);
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取账户删除队列');
    let accountsDeleted = 0;
    let accountFailures = 0;
    for (const item of due ?? []) {
      const userId = item.user_id as string;
      const { data: claimed, error: claimError } = await client
        .from('account_deletion_requests')
        .update({ status: 'executing' })
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select('user_id')
        .maybeSingle();
      if (claimError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法领取账户删除任务');
      if (!claimed) continue;
      try {
        const { data: boards, error: boardError } = await client
          .from('boards')
          .select('id')
          .eq('owner_id', userId);
        if (boardError) throw new Error('BOARD_LOOKUP_FAILED');
        const boardIds = (boards ?? []).map((board) => board.id as string);
        if (boardIds.length > 0) {
          const { data: assets, error: assetError } = await client
            .from('board_assets')
            .select('object_path')
            .in('board_id', boardIds);
          if (assetError) throw new Error('ASSET_LOOKUP_FAILED');
          const jobs = (assets ?? []).map((asset) => ({
            object_path: asset.object_path,
            reason: 'account_deleted',
            not_before: now,
            status: 'pending',
            attempts: 0,
          }));
          if (jobs.length > 0) {
            const { error: queueError } = await client
              .from('asset_cleanup_jobs')
              .upsert(jobs, { onConflict: 'object_path' });
            if (queueError) throw new Error('CLEANUP_QUEUE_FAILED');
          }
        }
        const { error: deleteError } = await client.auth.admin.deleteUser(userId);
        if (deleteError) throw deleteError;
        const actorHash = createHmac('sha256', required('ACTOR_HASH_SECRET'))
          .update(`user:${userId}`)
          .digest('hex');
        const { error: auditError } = await client.from('security_audit_events').insert({
          actor_hash: actorHash,
          event_type: 'account_deleted',
          outcome: 'success',
          request_id: requestId,
        });
        if (auditError) accountFailures += 1;
        accountsDeleted += 1;
      } catch {
        accountFailures += 1;
        const { error: markError } = await client
          .from('account_deletion_requests')
          .update({ status: 'failed' })
          .eq('user_id', userId)
          .eq('status', 'executing');
        if (markError) {
          throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法记录账户删除失败状态');
        }
      }
    }

    const { data: cleanup, error: cleanupReadError } = await client
      .from('asset_cleanup_jobs')
      .select('id,object_path,reason,attempts')
      .eq('status', 'pending')
      .lte('not_before', now)
      .limit(100);
    if (cleanupReadError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取资产清理队列');
    let assetsDeleted = 0;
    let assetFailures = 0;
    for (const job of cleanup ?? []) {
      const bucket = job.reason === 'temp_expired' ? 'ai-temp' : 'board-assets';
      const { error: removeError } = await client.storage
        .from(bucket)
        .remove([job.object_path as string]);
      if (!removeError) {
        const { error: completedError } = await client
          .from('asset_cleanup_jobs')
          .update({ status: 'completed' })
          .eq('id', job.id);
        if (completedError) {
          throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法记录资产清理完成状态');
        }
        assetsDeleted += 1;
      } else {
        assetFailures += 1;
        const attempts = Number(job.attempts) + 1;
        const { error: retryError } = await client
          .from('asset_cleanup_jobs')
          .update({
            attempts,
            status: attempts >= 10 ? 'failed' : 'pending',
            last_error_code: 'STORAGE_DELETE_FAILED',
          })
          .eq('id', job.id);
        if (retryError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法记录资产清理失败状态');
      }
    }
    const { error: purgeError } = await client.rpc('purge_expired_operational_records');
    if (purgeError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法清理过期运行记录');
    response.setHeader('X-Request-Id', requestId);
    response
      .status(accountFailures > 0 || assetFailures > 0 ? 207 : 200)
      .json({ data: { accountsDeleted, accountFailures, assetsDeleted, assetFailures } });
  } catch (error) {
    sendError(response, error, requestId);
  }
}
