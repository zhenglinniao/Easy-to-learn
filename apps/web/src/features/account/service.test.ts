import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { AccountApiError, AccountService } from './service';

const clientWith = (options: {
  accessToken?: string;
  pending?: { execute_after: string } | null;
  pendingError?: Error | null;
}) => {
  const maybeSingle = vi.fn(async () => ({
    data: options.pending ?? null,
    error: options.pendingError ?? null,
  }));
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle,
  };
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: options.accessToken ? { access_token: options.accessToken } : null },
      })),
    },
    from: vi.fn(() => query),
  } as unknown as SupabaseClient;
};

describe('AccountService', () => {
  it('读取待删除状态并规范化字段', async () => {
    const client = clientWith({ pending: { execute_after: '2026-10-04T00:00:00.000Z' } });
    const service = new AccountService(client);

    await expect(service.pendingDeletion()).resolves.toEqual({
      executeAfter: '2026-10-04T00:00:00.000Z',
    });
  });

  it('拒绝数据库返回的非法删除倒计时', async () => {
    const service = new AccountService(clientWith({ pending: { execute_after: 'invalid-date' } }));

    await expect(service.pendingDeletion()).rejects.toThrow();
  });

  it('没有会话时不发送删除请求', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new AccountService(clientWith({}), fetcher);

    await expect(service.requestDeletion()).rejects.toThrow('请先登录');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('携带令牌并解析删除冷静期', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { executeAfter: '2026-10-04T00:00:00.000Z' },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = new AccountService(clientWith({ accessToken: 'user-token' }), fetcher);

    await expect(service.requestDeletion()).resolves.toEqual({
      executeAfter: '2026-10-04T00:00:00.000Z',
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/account/deletion');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-token');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  });

  it('读取账户套餐与真实用量', async () => {
    const payload = {
      data: {
        configured: false,
        entitlement: {
          plan: 'free',
          source: 'free',
          subscriptionStatus: 'none',
          actionDailyLimit: 10,
          actionPeriodLimit: 45,
          imageDailyLimit: 2,
          imagePeriodLimit: 20,
          maxBoards: 100,
          maxStorageBytes: 1073741824,
          maxConcurrentAiTasks: 3,
          modelQualityTier: 'standard',
          unlimited: false,
          effectiveUntil: null,
          version: 1,
        },
        quota: {
          dailyLimit: 10,
          remaining: 8,
          nextAllowedAt: null,
          action: {
            dailyLimit: 10,
            dailyRemaining: 8,
            periodLimit: 45,
            periodRemaining: 43,
            nextAllowedAt: null,
            dailyResetsAt: '2026-09-30T00:00:00.000Z',
            periodResetsAt: '2026-10-29T00:00:00.000Z',
          },
          image: {
            dailyLimit: 2,
            dailyRemaining: 2,
            periodLimit: 20,
            periodRemaining: 20,
            periodResetsAt: null,
          },
          mode: 'full',
        },
        subscription: null,
        usage: { boards: 2, storageBytes: 4096 },
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const service = new AccountService(clientWith({ accessToken: 'user-token' }), fetcher);

    await expect(service.overview()).resolves.toMatchObject({ usage: { boards: 2 } });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/account/overview',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('取消删除请求使用 DELETE', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const service = new AccountService(clientWith({ accessToken: 'user-token' }), fetcher);

    await expect(service.cancelDeletion()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/account/deletion',
      expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }),
    );
  });

  it('保留账户接口错误码和追踪号', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'AUTH_REQUIRED',
          message: '删除账户前需要重新登录',
          requestId: 'account-trace-1',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = new AccountService(clientWith({ accessToken: 'user-token' }), fetcher);

    const error = await service.requestDeletion().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AccountApiError);
    expect(error).toMatchObject({
      code: 'AUTH_REQUIRED',
      requestId: 'account-trace-1',
      status: 401,
    });
    expect((error as Error).message).toContain('追踪号：account-trace-1');
  });
});
