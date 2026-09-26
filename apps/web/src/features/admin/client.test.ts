import { describe, expect, it, vi } from 'vitest';

import { AdminApiClient } from './client';

const overview = {
  accounts: [],
  pagination: { page: 1, perPage: 50, total: 0 },
  models: [
    {
      id: 'primary',
      type: 'openai-compatible',
      enabled: true,
      model: 'model-a',
      timeoutMs: 12_000,
    },
  ],
  policyUpdatedAt: null,
  pageSuspended: 0,
};

describe('AdminApiClient', () => {
  it('所有管理请求都携带登录令牌且不在请求中发送密钥', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: overview }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new AdminApiClient(async () => 'admin-token', fetcher);

    await expect(client.overview(1, 'learner')).resolves.toEqual(overview);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('search=learner');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer admin-token');
    expect(JSON.stringify(init)).not.toContain('apiKey');
  });

  it('保存模型策略和暂停账户使用 PATCH JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = new AdminApiClient(async () => 'admin-token', fetcher);

    await client.updateModels(overview.models);
    await client.updateAccount('00000000-0000-4000-8000-000000000001', 'suspend');

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/admin/models',
      expect.objectContaining({ method: 'PATCH', credentials: 'same-origin' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/admin/accounts',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('suspend'),
      }),
    );
  });

  it('没有管理员会话时不发起网络请求', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new AdminApiClient(async () => null, fetcher);
    await expect(client.overview()).rejects.toThrow('请先登录管理员账户');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
