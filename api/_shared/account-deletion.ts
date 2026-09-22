import { createHmac } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ApiFault } from './fault';

const COOLING_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000;
const RECENT_AUTH_MS = 10 * 60 * 1_000;

export interface AuthenticatedAccount {
  userId: string;
  authenticatedAt: Date;
}

export interface DeletionRecord {
  userId: string;
  requestedAt: string;
  executeAfter: string;
  status: 'pending' | 'cancelled' | 'executing' | 'completed' | 'failed';
}

export interface AccountDeletionStore {
  get(userId: string): Promise<DeletionRecord | null>;
  create(record: DeletionRecord): Promise<void>;
  cancel(userId: string): Promise<boolean>;
  audit(
    userId: string,
    eventType: string,
    outcome: 'success' | 'failure',
    requestId: string,
  ): Promise<void>;
}

export class AccountDeletionService {
  constructor(
    private readonly store: AccountDeletionStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async request(
    account: AuthenticatedAccount,
    requestId: string,
  ): Promise<{ executeAfter: string }> {
    const now = this.now();
    if (now.getTime() - account.authenticatedAt.getTime() > RECENT_AUTH_MS) {
      await this.store.audit(account.userId, 'account_deletion_requested', 'failure', requestId);
      throw new ApiFault('AUTH_REQUIRED', '删除账户前需要在最近 10 分钟内重新登录');
    }
    const existing = await this.store.get(account.userId);
    if (existing?.status === 'pending') return { executeAfter: existing.executeAfter };
    if (existing?.status === 'executing') {
      throw new ApiFault('DELETION_ALREADY_STARTED', '账户删除已经开始执行');
    }
    const record: DeletionRecord = {
      userId: account.userId,
      requestedAt: now.toISOString(),
      executeAfter: new Date(now.getTime() + COOLING_PERIOD_MS).toISOString(),
      status: 'pending',
    };
    await this.store.create(record);
    await this.store.audit(account.userId, 'account_deletion_requested', 'success', requestId);
    return { executeAfter: record.executeAfter };
  }

  async cancel(account: AuthenticatedAccount, requestId: string): Promise<void> {
    const current = await this.store.get(account.userId);
    if (!current || current.status === 'cancelled') return;
    if (current.status !== 'pending' || this.now().getTime() >= Date.parse(current.executeAfter)) {
      throw new ApiFault('DELETION_ALREADY_STARTED', '账户删除已经开始执行');
    }
    if (!(await this.store.cancel(account.userId))) {
      throw new ApiFault('DELETION_ALREADY_STARTED', '账户删除已经开始执行');
    }
    await this.store.audit(account.userId, 'account_deletion_cancelled', 'success', requestId);
  }
}

export class SupabaseAccountDeletionStore implements AccountDeletionStore {
  private readonly client: SupabaseClient;
  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly actorHashSecret: string,
  ) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  async get(userId: string): Promise<DeletionRecord | null> {
    const { data, error } = await this.client
      .from('account_deletion_requests')
      .select('user_id,requested_at,execute_after,status')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '账户服务暂时不可用');
    return data
      ? ({
          userId: data.user_id,
          requestedAt: data.requested_at,
          executeAfter: data.execute_after,
          status: data.status,
        } as DeletionRecord)
      : null;
  }
  async create(record: DeletionRecord): Promise<void> {
    const { error } = await this.client.from('account_deletion_requests').upsert({
      user_id: record.userId,
      requested_at: record.requestedAt,
      execute_after: record.executeAfter,
      status: record.status,
    });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法创建账户删除请求');
  }
  async cancel(userId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('account_deletion_requests')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select('user_id')
      .maybeSingle();
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法取消账户删除请求');
    return data !== null;
  }
  async audit(
    userId: string,
    eventType: string,
    outcome: 'success' | 'failure',
    requestId: string,
  ): Promise<void> {
    const actorHash = createHmac('sha256', this.actorHashSecret)
      .update(`user:${userId}`)
      .digest('hex');
    const { error } = await this.client
      .from('security_audit_events')
      .insert({ actor_hash: actorHash, event_type: eventType, outcome, request_id: requestId });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '安全审计服务暂时不可用');
  }
}
