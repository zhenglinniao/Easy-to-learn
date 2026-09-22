import { describe, expect, it, vi } from 'vitest';

import {
  AccountDeletionService,
  type AccountDeletionStore,
  type DeletionRecord,
} from './account-deletion';

const now = new Date('2026-09-22T04:00:00.000Z');
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
