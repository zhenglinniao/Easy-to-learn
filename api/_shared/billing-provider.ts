import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SubscriptionPlan } from '@easy-to-learn/domain';

import { ApiFault } from './fault.js';

interface StripeObject {
  id?: unknown;
  url?: unknown;
  error?: { message?: unknown; code?: unknown };
}

const requireUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('unsafe URL');
    return url.origin;
  } catch {
    throw new ApiFault('DEPENDENCY_UNAVAILABLE', '订阅返回地址配置无效');
  }
};

export class StripeBillingProvider {
  private readonly supabase: SupabaseClient;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly secretKey: string,
    private readonly prices: Record<'plus' | 'pro', string>,
    private readonly appOrigin: string,
    private readonly fetcher: typeof fetch = fetch,
    supabase?: SupabaseClient,
  ) {
    this.supabase =
      supabase ??
      createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    this.appOrigin = requireUrl(appOrigin);
  }

  async checkout(userId: string, plan: Exclude<SubscriptionPlan, 'free'>): Promise<string> {
    const customerId = await this.customerId(userId);
    return this.stripeUrl('/v1/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      'line_items[0][price]': this.prices[plan],
      'line_items[0][quantity]': '1',
      'metadata[user_id]': userId,
      'metadata[plan_key]': plan,
      'subscription_data[metadata][user_id]': userId,
      'subscription_data[metadata][plan_key]': plan,
      allow_promotion_codes: 'true',
      success_url: `${this.appOrigin}/account?checkout=success`,
      cancel_url: `${this.appOrigin}/account?checkout=cancelled`,
    });
  }

  async portal(userId: string): Promise<string> {
    const customerId = await this.customerId(userId);
    return this.stripeUrl('/v1/billing_portal/sessions', {
      customer: customerId,
      return_url: `${this.appOrigin}/account`,
    });
  }

  private async customerId(userId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('billing_customers')
      .select('provider_customer_id')
      .eq('user_id', userId)
      .eq('provider', 'stripe')
      .maybeSingle();
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取订阅客户信息');
    if (data?.provider_customer_id) return String(data.provider_customer_id);

    const customerId = await this.stripeId('/v1/customers', {
      'metadata[user_id]': userId,
    });
    const { error: saveError } = await this.supabase.from('billing_customers').upsert(
      {
        user_id: userId,
        provider: 'stripe',
        provider_customer_id: customerId,
        livemode: this.secretKey.startsWith('sk_live_'),
      },
      { onConflict: 'user_id,provider' },
    );
    if (saveError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法保存订阅客户信息');
    return customerId;
  }

  private async stripeUrl(path: string, values: Record<string, string>): Promise<string> {
    const payload = await this.stripe(path, values);
    if (typeof payload.url !== 'string' || !payload.url.startsWith('https://')) {
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '支付服务未返回安全跳转地址');
    }
    return payload.url;
  }

  private async stripeId(path: string, values: Record<string, string>): Promise<string> {
    const payload = await this.stripe(path, values);
    if (typeof payload.id !== 'string' || payload.id.length < 3) {
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '支付服务未返回客户标识');
    }
    return payload.id;
  }

  private async stripe(path: string, values: Record<string, string>): Promise<StripeObject> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.stripe.com${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(values).toString(),
      });
    } catch {
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '支付服务暂时不可用');
    }
    const payload = (await response.json().catch(() => ({}))) as StripeObject;
    if (!response.ok) {
      const providerCode =
        typeof payload.error?.code === 'string' ? payload.error.code.slice(0, 100) : null;
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '支付服务暂时不可用', {
        ...(providerCode ? { providerCode } : {}),
      });
    }
    return payload;
  }
}
