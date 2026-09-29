import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { StripeWebhookService } from './billing-webhook.js';

const queryWith = (result: unknown) => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    insert: vi.fn(async () => ({ error: null })),
    upsert: vi.fn(async () => ({ error: null })),
    update: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return query;
};

const activeEvent = {
  id: 'evt_active',
  type: 'customer.subscription.updated',
  created: 1_800_000_000,
  data: {
    object: {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { user_id: '00000000-0000-4000-8000-000000000001' },
      items: {
        data: [
          {
            price: { id: 'price_plus' },
            current_period_start: 1_799_000_000,
            current_period_end: 1_801_000_000,
          },
        ],
      },
    },
  },
};

describe('StripeWebhookService', () => {
  it('把有效订阅事实和对应权益原子化写入服务端表', async () => {
    const events = queryWith({ data: null, error: null });
    const subscriptions = queryWith({ data: null, error: null });
    const entitlements = queryWith({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'billing_webhook_events'
          ? events
          : table === 'billing_subscriptions'
            ? subscriptions
            : entitlements,
      ),
    } as unknown as SupabaseClient;
    const service = new StripeWebhookService(
      'u',
      'k',
      { plus: 'price_plus', pro: 'price_pro' },
      supabase,
    );

    await expect(
      service.process(activeEvent, JSON.stringify(activeEvent)),
    ).resolves.toBeUndefined();
    expect(subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_key: 'plus',
        status: 'active',
        provider_event_created_at: expect.any(String),
      }),
      { onConflict: 'provider,provider_subscription_id' },
    );
    expect(entitlements.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_key: 'plus',
        action_daily_limit: 60,
        source: 'subscription',
        version: 2,
      }),
      { onConflict: 'user_id' },
    );
    expect(events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'evt_active',
        payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('已处理事件直接返回，较旧的订阅事件不会覆盖新状态', async () => {
    const processed = queryWith({ data: { status: 'processed' }, error: null });
    const supabaseProcessed = { from: vi.fn(() => processed) } as unknown as SupabaseClient;
    await new StripeWebhookService('u', 'k', { plus: 'p1', pro: 'p2' }, supabaseProcessed).process(
      activeEvent,
      '{}',
    );
    expect(processed.insert).not.toHaveBeenCalled();

    const events = queryWith({ data: null, error: null });
    const subscriptions = queryWith({
      data: { provider_event_created_at: '2030-01-01T00:00:00.000Z' },
      error: null,
    });
    const supabaseOld = {
      from: vi.fn((table: string) => (table === 'billing_webhook_events' ? events : subscriptions)),
    } as unknown as SupabaseClient;
    await new StripeWebhookService(
      'u',
      'k',
      { plus: 'price_plus', pro: 'price_pro' },
      supabaseOld,
    ).process(activeEvent, '{}');
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('拒绝缺少受信价格映射的订阅事件并标记失败供 Stripe 重试', async () => {
    const events = queryWith({ data: null, error: null });
    const subscriptions = queryWith({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) => (table === 'billing_webhook_events' ? events : subscriptions)),
    } as unknown as SupabaseClient;
    const service = new StripeWebhookService('u', 'k', { plus: 'other', pro: 'pro' }, supabase);
    await expect(service.process(activeEvent, '{}')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(events.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });
});
