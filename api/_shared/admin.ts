import { createHmac, randomUUID } from 'node:crypto';

import { createClient, type User } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';

import { loadAiProviderConfigs } from './ai-provider-config.js';
import { AdminModelPolicyStore, type AdminModelPolicy } from './admin-model-policy.js';
import { ApiFault } from './fault.js';
import type { HttpRequest } from './http.js';
import { resolveActor } from './runtime.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '管理员服务配置尚未完成');
  return value;
};

const adminIds = (): Set<string> =>
  new Set(
    required('ADMIN_USER_IDS')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

export const requireAdmin = async (request: HttpRequest): Promise<string> => {
  const { actor } = await resolveActor(request);
  if (actor.kind !== 'user' || !adminIds().has(actor.id)) {
    throw new ApiFault('FORBIDDEN', '当前账户没有管理员权限');
  }
  return actor.id;
};

const maskEmail = (email?: string): string => {
  if (!email) return '未设置邮箱';
  const [name = '', domain = ''] = email.split('@');
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, name.length - visible.length)))}@${domain}`;
};

const isSuspended = (user: User): boolean =>
  Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now());

export interface AdminAccountSummary {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  suspended: boolean;
  boardCount: number;
}

export class AdminService {
  private readonly supabase = createClient(
    required('SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  private readonly policyStore = new AdminModelPolicyStore(Redis.fromEnv());
  private readonly actorHashSecret = required('ACTOR_HASH_SECRET');

  async overview(
    page: number,
    search: string,
  ): Promise<{
    accounts: AdminAccountSummary[];
    pagination: { page: number; perPage: number; total: number };
    models: Array<{ id: string; type: string; enabled: boolean; model: string; timeoutMs: number }>;
    policyUpdatedAt: string | null;
    pageSuspended: number;
  }> {
    const perPage = 50;
    const { data, error } = await this.supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取账户列表');
    const needle = search.trim().toLowerCase();
    const users = data.users.filter(
      (user) =>
        !needle ||
        user.id.toLowerCase().includes(needle) ||
        user.email?.toLowerCase().includes(needle),
    );
    const userIds = users.map(({ id }) => id);
    const boardCounts = new Map<string, number>();
    if (userIds.length > 0) {
      const { data: boards, error: boardError } = await this.supabase
        .from('boards')
        .select('owner_id')
        .in('owner_id', userIds);
      if (boardError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取账户画板统计');
      for (const board of boards ?? []) {
        const ownerId = String(board.owner_id);
        boardCounts.set(ownerId, (boardCounts.get(ownerId) ?? 0) + 1);
      }
    }
    const accounts = users.map((user): AdminAccountSummary => ({
      id: user.id,
      email: maskEmail(user.email),
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      emailConfirmed: Boolean(user.email_confirmed_at),
      suspended: isSuspended(user),
      boardCount: boardCounts.get(user.id) ?? 0,
    }));
    const configs = loadAiProviderConfigs(process.env);
    const policy = await this.policyStore.read(configs);
    return {
      accounts,
      pagination: { page, perPage, total: data.total ?? accounts.length },
      models: policy.providers.map((provider) => ({
        id: provider.id,
        type: configs.find(({ id }) => id === provider.id)?.type ?? 'unknown',
        enabled: provider.enabled,
        model: provider.model,
        timeoutMs: provider.timeoutMs,
      })),
      policyUpdatedAt: policy.updatedAt,
      pageSuspended: accounts.filter(({ suspended }) => suspended).length,
    };
  }

  async updateModels(adminUserId: string, body: unknown): Promise<AdminModelPolicy> {
    const configs = loadAiProviderConfigs(process.env);
    const policy = await this.policyStore.write(configs, body, adminUserId);
    await this.audit(adminUserId, 'admin_model_policy_updated', 'success');
    return policy;
  }

  async updateAccount(
    adminUserId: string,
    body: unknown,
  ): Promise<{ userId: string; suspended: boolean }> {
    if (!body || typeof body !== 'object') throw new ApiFault('INVALID_INPUT', '账户操作格式错误');
    const { userId, action } = body as { userId?: unknown; action?: unknown };
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new ApiFault('INVALID_INPUT', '用户 ID 格式错误');
    }
    if (action !== 'suspend' && action !== 'restore') {
      throw new ApiFault('INVALID_INPUT', '账户操作不受支持');
    }
    if (userId === adminUserId && action === 'suspend') {
      throw new ApiFault('FORBIDDEN', '不能暂停当前管理员账户');
    }
    const suspended = action === 'suspend';
    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      ban_duration: suspended ? '876000h' : 'none',
    });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法更新账户状态');
    await this.audit(
      adminUserId,
      suspended ? 'admin_account_suspended' : 'admin_account_restored',
      'success',
      userId,
    );
    return { userId, suspended };
  }

  private async audit(
    adminUserId: string,
    eventType: string,
    outcome: 'success' | 'failure',
    targetUserId?: string,
  ): Promise<void> {
    const hash = (value: string) =>
      createHmac('sha256', this.actorHashSecret).update(value).digest('hex');
    const { error } = await this.supabase.from('security_audit_events').insert({
      actor_hash: hash(`user:${adminUserId}`),
      event_type: eventType,
      outcome,
      target_hash: targetUserId ? hash(`user:${targetUserId}`) : null,
      request_id: randomUUID(),
    });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '管理员审计日志写入失败');
  }
}
