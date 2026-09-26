import { beforeEach, describe, expect, it, vi } from 'vitest';

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface FluentQuery extends PromiseLike<QueryResult> {
  select(...args: unknown[]): FluentQuery;
  eq(...args: unknown[]): FluentQuery;
  maybeSingle(...args: unknown[]): FluentQuery;
  upsert(...args: unknown[]): FluentQuery;
  update(...args: unknown[]): FluentQuery;
  insert(...args: unknown[]): FluentQuery;
}

const query = (result: QueryResult): FluentQuery => {
  const value = {} as FluentQuery;
  value.select = vi.fn(() => value);
  value.eq = vi.fn(() => value);
  value.maybeSingle = vi.fn(() => value);
  value.upsert = vi.fn(() => value);
  value.update = vi.fn(() => value);
  value.insert = vi.fn(() => value);
  value.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return value;
};

const from = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn(() => ({ from })));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

import {
  AccountDeletionService,
  SupabaseAccountDeletionStore,
  type AccountDeletionStore,
  type DeletionRecord,
} from './account-deletion.js';

const now = new Date('2026-09-22T04:00:00.000Z');

beforeEach(() => {
  from.mockReset();
  createClient.mockClear();
});
const createStore = (initial: DeletionRecord | null = null) => {
  let record = initial;
  const store: AccountDeletionStore = {
    get: vi.fn(async () => record),
    create: vi.fn(async (next) => {
      record = next;
    }),
    cancel: vi.fn(async () => {
      if (record?.status !== 'pending') return false;
      record = { ...record, status: 'cancelled' };
      return true;
    }),
    audit: vi.fn(async () => undefined),
  };
  return store;
};

describe('AccountDeletionService', () => {
  it('要求最近认证并创建固定 7 天冷静期', async () => {
    const store = createStore();
    const service = new AccountDeletionService(store, () => now);
    await expect(
      service.request(
        { userId: 'u1', authenticatedAt: new Date(now.getTime() - 11 * 60_000) },
        'r1',
      ),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(service.request({ userId: 'u1', authenticatedAt: now }, 'r2')).resolves.toEqual({
      executeAfter: '2026-09-29T04:00:00.000Z',
    });
    expect(store.create).toHaveBeenCalledOnce();
  });

  it('重复请求幂等，冷静期内可以取消', async () => {
    const pending: DeletionRecord = {
      userId: 'u1',
      requestedAt: now.toISOString(),
      executeAfter: '2026-09-29T04:00:00.000Z',
      status: 'pending',
    };
    const store = createStore(pending);
    const service = new AccountDeletionService(store, () => now);
    await expect(service.request({ userId: 'u1', authenticatedAt: now }, 'r1')).resolves.toEqual({
      executeAfter: pending.executeAfter,
    });
    expect(store.create).not.toHaveBeenCalled();
    await service.cancel({ userId: 'u1', authenticatedAt: now }, 'r2');
    expect(store.cancel).toHaveBeenCalledOnce();
  });

  it('执行开始或冷静期结束后拒绝取消', async () => {
    const executing: DeletionRecord = {
      userId: 'u1',
      requestedAt: now.toISOString(),
      executeAfter: '2026-09-21T04:00:00.000Z',
      status: 'executing',
    };
    const service = new AccountDeletionService(createStore(executing), () => now);
    await expect(
      service.cancel({ userId: 'u1', authenticatedAt: now }, 'r1'),
    ).rejects.toMatchObject({ code: 'DELETION_ALREADY_STARTED' });
  });
});

describe('SupabaseAccountDeletionStore', () => {
  const store = () =>
    new SupabaseAccountDeletionStore(
      'https://project.supabase.co',
      'service-role',
      'actor-hash-secret',
    );

  it('maps database deletion records to the service model', async () => {
    from.mockReturnValueOnce(
      query({
        data: {
          user_id: 'user-1',
          requested_at: '2026-09-22T04:00:00.000Z',
          execute_after: '2026-09-29T04:00:00.000Z',
          status: 'pending',
        },
        error: null,
      }),
    );

    await expect(store().get('user-1')).resolves.toEqual({
      userId: 'user-1',
      requestedAt: '2026-09-22T04:00:00.000Z',
      executeAfter: '2026-09-29T04:00:00.000Z',
      status: 'pending',
    });
  });

  it('upserts requests and only cancels pending rows', async () => {
    const createQuery = query({ data: null, error: null });
    const cancelQuery = query({ data: { user_id: 'user-1' }, error: null });
    from.mockReturnValueOnce(createQuery).mockReturnValueOnce(cancelQuery);
    const deletionStore = store();
    const record: DeletionRecord = {
      userId: 'user-1',
      requestedAt: '2026-09-22T04:00:00.000Z',
      executeAfter: '2026-09-29T04:00:00.000Z',
      status: 'pending',
    };

    await deletionStore.create(record);
    await expect(deletionStore.cancel('user-1')).resolves.toBe(true);

    expect(createQuery.upsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      requested_at: record.requestedAt,
      execute_after: record.executeAfter,
      status: 'pending',
    });
    expect(cancelQuery.update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(cancelQuery.eq).toHaveBeenCalledWith('status', 'pending');
  });

  it('hashes account identity in audit records', async () => {
    const auditQuery = query({ data: null, error: null });
    from.mockReturnValueOnce(auditQuery);

    await store().audit('raw-user-id', 'account_deletion_requested', 'success', 'request-1');

    expect(auditQuery.insert).toHaveBeenCalledWith({
      actor_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      event_type: 'account_deletion_requested',
      outcome: 'success',
      request_id: 'request-1',
    });
    expect(JSON.stringify(vi.mocked(auditQuery.insert).mock.calls)).not.toContain('raw-user-id');
  });

  it('maps database failures to a dependency fault', async () => {
    from.mockReturnValueOnce(query({ data: null, error: new Error('database unavailable') }));

    await expect(store().get('user-1')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});
