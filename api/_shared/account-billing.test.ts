import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { AccountBillingService, isBillingConfigured } from './account-billing.js';
import { planEntitlement } from './entitlements.js';

const fluent = (result: unknown) => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    range: vi.fn(async () => result),
  };
  return query;
};

describe('AccountBillingService', () => {
  it('并行汇总权益、Redis 额度、订阅和真实资源用量', async () => {
    const subscription = fluent({
      data: {
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: '2026-10-29T00:00:00.000Z',
      },
      error: null,
    });
    const boards = fluent({ count: 3, error: null });
    boards.eq.mockImplementation(() => Promise.resolve({ count: 3, error: null }) as never);
    const assets = fluent({ data: [{ byte_size: 100 }, { byte_size: 250 }], error: null });
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'billing_subscriptions' ? subscription : table === 'boards' ? boards : assets,
      ),
    } as unknown as SupabaseClient;
    const quota = { dailyLimit: 60, remaining: 59 };
    const aiState = { status: vi.fn(async () => quota) };
    const entitlements = { resolve: vi.fn(async () => planEntitlement('plus')) };
    const service = new AccountBillingService(
      'u',
      'k',
      aiState as never,
      true,
      supabase,
      entitlements as never,
    );

    await expect(
      service.summary('user-1', new Date('2026-09-29T00:00:00Z')),
    ).resolves.toMatchObject({
      configured: true,
      entitlement: { plan: 'plus' },
      subscription: { status: 'active' },
      usage: { boards: 3, storageBytes: 350 },
      quota,
    });
    expect(aiState.status).toHaveBeenCalledWith('user:user-1', expect.any(Date));
  });

  it('只有支付闭环的四项配置齐全才声明订阅已启用', () => {
    const complete = {
      STRIPE_SECRET_KEY: 's',
      STRIPE_PLUS_PRICE_ID: 'p1',
      STRIPE_PRO_PRICE_ID: 'p2',
      STRIPE_WEBHOOK_SECRET: 'w',
    } as NodeJS.ProcessEnv;
    expect(isBillingConfigured(complete)).toBe(true);
    expect(isBillingConfigured({ ...complete, STRIPE_WEBHOOK_SECRET: '' })).toBe(false);
  });
});
