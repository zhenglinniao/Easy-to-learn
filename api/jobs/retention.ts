import { createHmac, randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { ApiFault } from '../_shared/fault.js';
import { header, sendError, type HttpRequest, type HttpResponse } from '../_shared/http.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '服务配置尚未完成');
  return value;
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    if (header(request, 'authorization') !== `Bearer ${required('CRON_SECRET')}`)
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
    for (const item of due ?? []) {
      const userId = item.user_id as string;
      const { data: claimed } = await client
        .from('account_deletion_requests')
        .update({ status: 'executing' })
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select('user_id')
        .maybeSingle();
      if (!claimed) continue;
      try {
        const { data: boards } = await client.from('boards').select('id').eq('owner_id', userId);
        const boardIds = (boards ?? []).map((board) => board.id as string);
        if (boardIds.length > 0) {
          const { data: assets } = await client
            .from('board_assets')
            .select('object_path')
            .in('board_id', boardIds);
          const jobs = (assets ?? []).map((asset) => ({
            object_path: asset.object_path,
            reason: 'account_deleted',
            not_before: now,
            status: 'pending',
            attempts: 0,
          }));
          if (jobs.length > 0)
            await client.from('asset_cleanup_jobs').upsert(jobs, { onConflict: 'object_path' });
        }
        const { error: deleteError } = await client.auth.admin.deleteUser(userId);
        if (deleteError) throw deleteError;
        const actorHash = createHmac('sha256', required('ACTOR_HASH_SECRET'))
          .update(`user:${userId}`)
          .digest('hex');
        await client.from('security_audit_events').insert({
          actor_hash: actorHash,
          event_type: 'account_deleted',
          outcome: 'success',
          request_id: requestId,
        });
        accountsDeleted += 1;
      } catch {
        await client
          .from('account_deletion_requests')
          .update({ status: 'failed' })
          .eq('user_id', userId)
          .eq('status', 'executing');
      }
    }

    const { data: cleanup } = await client
      .from('asset_cleanup_jobs')
      .select('id,object_path,reason,attempts')
      .eq('status', 'pending')
      .lte('not_before', now)
      .limit(100);
    let assetsDeleted = 0;
    for (const job of cleanup ?? []) {
      const bucket = job.reason === 'temp_expired' ? 'ai-temp' : 'board-assets';
      const { error: removeError } = await client.storage
        .from(bucket)
        .remove([job.object_path as string]);
      if (!removeError) {
        await client.from('asset_cleanup_jobs').update({ status: 'completed' }).eq('id', job.id);
        assetsDeleted += 1;
      } else {
        const attempts = Number(job.attempts) + 1;
        await client
          .from('asset_cleanup_jobs')
          .update({
            attempts,
            status: attempts >= 10 ? 'failed' : 'pending',
            last_error_code: 'STORAGE_DELETE_FAILED',
          })
          .eq('id', job.id);
      }
    }
    await client.rpc('purge_expired_operational_records');
    response.setHeader('X-Request-Id', requestId);
    response.status(200).json({ data: { accountsDeleted, assetsDeleted } });
  } catch (error) {
    sendError(response, error, requestId);
  }
}
