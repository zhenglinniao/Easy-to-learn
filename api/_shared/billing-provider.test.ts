import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { StripeBillingProvider } from './billing-provider.js';

const client = (customerId: string | null, saveError: unknown = null) => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: customerId ? { provider_customer_id: customerId } : null,
      error: null,
    })),
  };
  const upsert = vi.fn(async () => ({ error: saveError }));
  return {
    value: { from: vi.fn(() => ({ ...query, upsert })) } as unknown as SupabaseClient,
    upsert,
  };
};

describe('StripeBillingProvider', () => {
  it('使用已有客户创建订阅 Checkout，并固定回跳到第一方账户中心', async () => {
    const database = client('cus_existing');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ url: 'https://checkout.stripe.com/c/pay' }));
    const provider = new StripeBillingProvider(
      'https://db.test',
      'role',
      'sk_test_key',
      { plus: 'price_plus', pro: 'price_pro' },
      'https://easy.example.com',
      fetcher,
      database.value,
    );

    await expect(provider.checkout('user-1', 'plus')).resolves.toBe(
      'https://checkout.stripe.com/c/pay',
    );
    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(body).toContain('line_items%5B0%5D%5Bprice%5D=price_plus');
    expect(body).toContain('customer=cus_existing');
    expect(body).toContain('success_url=https%3A%2F%2Feasy.example.com%2Faccount');
  });

  it('首次订阅时创建并只在服务端保存 Stripe 客户标识', async () => {
    const database = client(null);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'cus_new' }))
      .mockResolvedValueOnce(Response.json({ url: 'https://billing.stripe.com/p/session' }));
    const provider = new StripeBillingProvider(
      'https://db.test',
      'role',
      'sk_live_key',
      { plus: 'p1', pro: 'p2' },
      'https://easy.example.com',
      fetcher,
      database.value,
    );

    await expect(provider.portal('user-2')).resolves.toContain('billing.stripe.com');
    expect(database.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ provider_customer_id: 'cus_new', livemode: true }),
      { onConflict: 'user_id,provider' },
    );
  });

  it('拒绝不安全回跳地址和供应商错误', async () => {
    const database = client('cus_1');
    expect(
      () =>
        new StripeBillingProvider(
          'u',
          'k',
          's',
          { plus: 'p1', pro: 'p2' },
          'javascript:alert(1)',
          fetch,
          database.value,
        ),
    ).toThrow('返回地址配置无效');
    const provider = new StripeBillingProvider(
      'u',
      'k',
      's',
      { plus: 'p1', pro: 'p2' },
      'https://easy.example.com',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: { code: 'rate_limit' } }, { status: 429 })),
      database.value,
    );
    await expect(provider.checkout('user', 'pro')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});
