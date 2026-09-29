import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  planEntitlement,
  quotaPolicyFromEntitlement,
  SupabaseEntitlementResolver,
} from './entitlements.js';

const resolver = (data: unknown, error: unknown = null, now = '2026-09-29T00:00:00.000Z') => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data, error }),
  };
  const client = { from: () => query } as unknown as SupabaseClient;
  return new SupabaseEntitlementResolver('u', 'k', () => new Date(now), client);
};

describe('subscription entitlements', () => {
  it('keeps the existing free allowance and increases paid AI limits', () => {
    const free = planEntitlement('free');
    const plus = planEntitlement('plus');
    const pro = planEntitlement('pro');

    expect(free).toMatchObject({ actionDailyLimit: 10, imageDailyLimit: 2, plan: 'free' });
    expect(plus.actionDailyLimit).toBeGreaterThan(free.actionDailyLimit);
    expect(pro.actionDailyLimit).toBeGreaterThan(plus.actionDailyLimit);
    expect(pro.imageDailyLimit).toBeGreaterThan(plus.imageDailyLimit);
  });

  it('converts normalized entitlements into Redis quota policy', () => {
    expect(quotaPolicyFromEntitlement({ ...planEntitlement('plus'), version: 2 })).toEqual({
      limits: { actionDaily: 60, actionPeriod: 600, imageDaily: 10, imagePeriod: 120 },
      version: 2,
    });
  });

  it('缺少权益行或权益已过期时安全回退免费版', async () => {
    await expect(resolver(null).resolve('user-1')).resolves.toMatchObject({ plan: 'free' });
    const expired = {
      plan_key: 'plus',
      source: 'subscription',
      subscription_status: 'active',
      action_daily_limit: 60,
      action_period_limit: 600,
      image_daily_limit: 10,
      image_period_limit: 120,
      max_boards: 100,
      max_storage_bytes: 1_073_741_824,
      max_concurrent_ai_tasks: 3,
      model_quality_tier: 'enhanced',
      unlimited: false,
      effective_until: '2026-09-28T00:00:00.000Z',
      version: 2,
    };
    await expect(resolver(expired).resolve('user-1')).resolves.toMatchObject({ plan: 'free' });
    await expect(
      resolver({ ...expired, effective_until: null }).resolve('user-1'),
    ).resolves.toMatchObject({ plan: 'plus', version: 2 });
  });

  it('数据库失败或非法权益行不会被当作免费额度静默放行', async () => {
    await expect(resolver(null, new Error('db down')).resolve('user')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    await expect(resolver({ plan_key: 'vip' }).resolve('user')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});
