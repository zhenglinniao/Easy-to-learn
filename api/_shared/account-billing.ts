import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BillingSummary } from '@easy-to-learn/domain';

import type { AiStateStore } from './ai-state.js';
import { SupabaseEntitlementResolver } from './entitlements.js';
import { ApiFault } from './fault.js';

const ASSET_PAGE_SIZE = 1_000;

interface SubscriptionRow {
  status: BillingSummary['entitlement']['subscriptionStatus'];
  cancel_at_period_end: boolean;
  current_period_end: string | null;
}

export class AccountBillingService {
  private readonly supabase: SupabaseClient;
  private readonly entitlements: SupabaseEntitlementResolver;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly aiState: AiStateStore,
    private readonly billingConfigured: boolean,
    supabase?: SupabaseClient,
    entitlements?: SupabaseEntitlementResolver,
  ) {
    this.supabase =
      supabase ??
      createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    this.entitlements =
      entitlements ?? new SupabaseEntitlementResolver(supabaseUrl, serviceRoleKey);
  }

  async summary(userId: string, now = new Date()): Promise<BillingSummary> {
    const [resolvedEntitlement, quota, subscription, usage] = await Promise.all([
      this.entitlements.resolve(userId),
      this.aiState.status(`user:${userId}`, now),
      this.subscription(userId),
      this.usage(userId),
    ]);
    const entitlement =
      quota.unlimited && !resolvedEntitlement.unlimited
        ? {
            ...resolvedEntitlement,
            plan: 'pro' as const,
            source: 'admin_override' as const,
            modelQualityTier: 'premium' as const,
            unlimited: true,
          }
        : resolvedEntitlement;
    return {
      configured: this.billingConfigured,
      entitlement,
      quota,
      subscription,
      usage,
    };
  }

  private async subscription(userId: string): Promise<BillingSummary['subscription']> {
    const { data, error } = await this.supabase
      .from('billing_subscriptions')
      .select('status,cancel_at_period_end,current_period_end')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取订阅状态');
    if (!data) return null;
    const row = data as SubscriptionRow;
    return {
      status: row.status,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      currentPeriodEnd: row.current_period_end,
    };
  }

  private async usage(userId: string): Promise<BillingSummary['usage']> {
    const { count, error: boardError } = await this.supabase
      .from('boards')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId);
    if (boardError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取账户用量');

    let storageBytes = 0;
    let offset = 0;
    while (true) {
      const { data, error } = await this.supabase
        .from('board_assets')
        .select('byte_size,boards!inner(owner_id)')
        .eq('boards.owner_id', userId)
        .range(offset, offset + ASSET_PAGE_SIZE - 1);
      if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '无法读取账户存储用量');
      const assets = (data ?? []) as unknown as Array<{ byte_size: number }>;
      storageBytes += assets.reduce((total, asset) => total + Number(asset.byte_size), 0);
      if (assets.length < ASSET_PAGE_SIZE) break;
      offset += ASSET_PAGE_SIZE;
    }
    return { boards: count ?? 0, storageBytes };
  }
}

export const isBillingConfigured = (environment: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(
    environment.STRIPE_SECRET_KEY?.trim() &&
    environment.STRIPE_PLUS_PRICE_ID?.trim() &&
    environment.STRIPE_PRO_PRICE_ID?.trim() &&
    environment.STRIPE_WEBHOOK_SECRET?.trim(),
  );
