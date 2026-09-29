import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { subscriptionStatusSchema, type SubscriptionPlan } from '@easy-to-learn/domain';

import { planEntitlement } from './entitlements.js';
import { ApiFault } from './fault.js';

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

const equalSignature = (actual: string, expected: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const verifyStripeSignature = (
  payload: string,
  signature: string,
  secret: string,
  now = Date.now(),
): void => {
  const values = signature.split(',').reduce<Record<string, string[]>>((result, part) => {
    const [key, value] = part.trim().split('=', 2);
    if (key && value) (result[key] ??= []).push(value);
    return result;
  }, {});
  const timestamp = Number(values.t?.[0]);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1_000 - timestamp) > 300) {
    throw new ApiFault('FORBIDDEN', '支付回调签名已过期');
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  if (!values.v1?.some((candidate) => equalSignature(candidate, expected))) {
    throw new ApiFault('FORBIDDEN', '支付回调签名无效');
  }
};

const epoch = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1_000).toISOString()
    : null;

const planFromPrice = (
  priceId: string,
  prices: Record<'plus' | 'pro', string>,
): Exclude<SubscriptionPlan, 'free'> | null =>
  priceId === prices.plus ? 'plus' : priceId === prices.pro ? 'pro' : null;

export class StripeWebhookService {
  private readonly supabase: SupabaseClient;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly prices: Record<'plus' | 'pro', string>,
    supabase?: SupabaseClient,
  ) {
    this.supabase =
      supabase ??
      createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }

  async process(event: StripeEvent, rawPayload: string): Promise<void> {
    if (!event.id || !event.type || !Number.isFinite(event.created) || !event.data?.object) {
      throw new ApiFault('INVALID_INPUT', '支付回调格式无效');
    }
    const existing = await this.eventStatus(event.id);
    if (existing === 'processed') return;
    if (!existing) await this.recordEvent(event, rawPayload);

    try {
      if (event.type.startsWith('customer.subscription.')) {
        await this.applySubscription(event);
      }
      await this.finishEvent(event.id, 'processed');
    } catch (error) {
      await this.finishEvent(event.id, 'failed');
      throw error;
    }
  }

  private async applySubscription(event: StripeEvent): Promise<void> {
    const object = event.data.object;
    const subscriptionId = typeof object.id === 'string' ? object.id : '';
    const customerId = typeof object.customer === 'string' ? object.customer : '';
    const metadata =
      object.metadata && typeof object.metadata === 'object'
        ? (object.metadata as Record<string, unknown>)
        : {};
    let userId = typeof metadata.user_id === 'string' ? metadata.user_id : '';
    if (!userId && customerId) {
      const { data, error } = await this.supabase
        .from('billing_customers')
        .select('user_id')
        .eq('provider', 'stripe')
        .eq('provider_customer_id', customerId)
        .maybeSingle();
      if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法匹配订阅账户');
      userId = data?.user_id ? String(data.user_id) : '';
    }
    const items = object.items as { data?: Array<Record<string, unknown>> } | undefined;
    const item = items?.data?.[0];
    const price = item?.price as Record<string, unknown> | undefined;
    const priceId = typeof price?.id === 'string' ? price.id : '';
    const plan = planFromPrice(priceId, this.prices);
    const parsedStatus = subscriptionStatusSchema.safeParse(object.status);
    if (!userId || !subscriptionId || !plan || !parsedStatus.success) {
      throw new ApiFault('INVALID_INPUT', '订阅回调缺少账户、价格或状态');
    }

    const eventCreatedAt = new Date(event.created * 1_000).toISOString();
    const { data: current, error: currentError } = await this.supabase
      .from('billing_subscriptions')
      .select('provider_event_created_at')
      .eq('provider', 'stripe')
      .eq('provider_subscription_id', subscriptionId)
      .maybeSingle();
    if (currentError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取订阅版本');
    if (
      current?.provider_event_created_at &&
      Date.parse(String(current.provider_event_created_at)) > Date.parse(eventCreatedAt)
    ) {
      return;
    }

    const { error: subscriptionError } = await this.supabase.from('billing_subscriptions').upsert(
      {
        user_id: userId,
        provider: 'stripe',
        provider_subscription_id: subscriptionId,
        provider_price_id: priceId,
        plan_key: plan,
        status: parsedStatus.data,
        cancel_at_period_end: object.cancel_at_period_end === true,
        current_period_start: epoch(object.current_period_start ?? item?.current_period_start),
        current_period_end: epoch(object.current_period_end ?? item?.current_period_end),
        trial_end: epoch(object.trial_end),
        provider_event_created_at: eventCreatedAt,
      },
      { onConflict: 'provider,provider_subscription_id' },
    );
    if (subscriptionError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法保存订阅状态');

    const accessActive = parsedStatus.data === 'active' || parsedStatus.data === 'trialing';
    const entitlement = planEntitlement(accessActive ? plan : 'free');
    const { error: entitlementError } = await this.supabase.from('account_entitlements').upsert(
      {
        user_id: userId,
        plan_key: entitlement.plan,
        source: accessActive ? 'subscription' : 'free',
        subscription_status: parsedStatus.data,
        action_daily_limit: entitlement.actionDailyLimit,
        action_period_limit: entitlement.actionPeriodLimit,
        image_daily_limit: entitlement.imageDailyLimit,
        image_period_limit: entitlement.imagePeriodLimit,
        max_boards: entitlement.maxBoards,
        max_storage_bytes: entitlement.maxStorageBytes,
        max_concurrent_ai_tasks: entitlement.maxConcurrentAiTasks,
        model_quality_tier: entitlement.modelQualityTier,
        unlimited: false,
        effective_until: null,
        version: entitlement.plan === 'free' ? 1 : entitlement.plan === 'plus' ? 2 : 3,
      },
      { onConflict: 'user_id' },
    );
    if (entitlementError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法更新账户权益');
  }

  private async eventStatus(eventId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('billing_webhook_events')
      .select('status')
      .eq('provider', 'stripe')
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取支付回调状态');
    return data?.status ? String(data.status) : null;
  }

  private async recordEvent(event: StripeEvent, rawPayload: string): Promise<void> {
    const objectId = typeof event.data.object.id === 'string' ? event.data.object.id : null;
    const { error } = await this.supabase.from('billing_webhook_events').insert({
      provider: 'stripe',
      event_id: event.id,
      event_type: event.type,
      object_id: objectId,
      payload_hash: createHash('sha256').update(rawPayload).digest('hex'),
      status: 'received',
      attempts: 1,
    });
    if (error && error.code !== '23505') {
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法登记支付回调');
    }
  }

  private async finishEvent(eventId: string, status: 'processed' | 'failed'): Promise<void> {
    const { error } = await this.supabase
      .from('billing_webhook_events')
      .update({ status, processed_at: new Date().toISOString() })
      .eq('provider', 'stripe')
      .eq('event_id', eventId);
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法完成支付回调');
  }
}

export const parseStripeEvent = (payload: string): StripeEvent => {
  try {
    return JSON.parse(payload) as StripeEvent;
  } catch {
    throw new ApiFault('INVALID_INPUT', '支付回调不是有效 JSON');
  }
};
