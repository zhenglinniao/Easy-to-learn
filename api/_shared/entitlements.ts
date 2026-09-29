import {
  accountEntitlementSchema,
  type AccountEntitlement,
  type SubscriptionPlan,
} from '@easy-to-learn/domain';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ApiFault } from './fault.js';
import type { QuotaLimits } from './ai-state.js';

const GIBIBYTE = 1024 * 1024 * 1024;

export const planEntitlement = (plan: SubscriptionPlan): AccountEntitlement => {
  if (plan === 'plus') {
    return {
      plan,
      source: 'subscription',
      subscriptionStatus: 'active',
      actionDailyLimit: 60,
      actionPeriodLimit: 600,
      imageDailyLimit: 10,
      imagePeriodLimit: 120,
      maxBoards: 100,
      maxStorageBytes: GIBIBYTE,
      maxConcurrentAiTasks: 3,
      modelQualityTier: 'enhanced',
      unlimited: false,
      effectiveUntil: null,
      version: 1,
    };
  }
  if (plan === 'pro') {
    return {
      plan,
      source: 'subscription',
      subscriptionStatus: 'active',
      actionDailyLimit: 200,
      actionPeriodLimit: 3_000,
      imageDailyLimit: 30,
      imagePeriodLimit: 600,
      maxBoards: 100,
      maxStorageBytes: GIBIBYTE,
      maxConcurrentAiTasks: 3,
      modelQualityTier: 'premium',
      unlimited: false,
      effectiveUntil: null,
      version: 1,
    };
  }
  return {
    plan: 'free',
    source: 'free',
    subscriptionStatus: 'none',
    actionDailyLimit: 10,
    actionPeriodLimit: 45,
    imageDailyLimit: 2,
    imagePeriodLimit: 20,
    maxBoards: 100,
    maxStorageBytes: GIBIBYTE,
    maxConcurrentAiTasks: 3,
    modelQualityTier: 'standard',
    unlimited: false,
    effectiveUntil: null,
    version: 1,
  };
};

const fromRow = (row: Record<string, unknown>): AccountEntitlement =>
  accountEntitlementSchema.parse({
    plan: row.plan_key,
    source: row.source,
    subscriptionStatus: row.subscription_status,
    actionDailyLimit: row.action_daily_limit,
    actionPeriodLimit: row.action_period_limit,
    imageDailyLimit: row.image_daily_limit,
    imagePeriodLimit: row.image_period_limit,
    maxBoards: row.max_boards,
    maxStorageBytes: row.max_storage_bytes,
    maxConcurrentAiTasks: row.max_concurrent_ai_tasks,
    modelQualityTier: row.model_quality_tier,
    unlimited: row.unlimited,
    effectiveUntil: row.effective_until,
    version: row.version,
  });

export const quotaPolicyFromEntitlement = (
  entitlement: AccountEntitlement,
): { limits: QuotaLimits; version: number } => ({
  limits: {
    actionDaily: entitlement.actionDailyLimit,
    actionPeriod: entitlement.actionPeriodLimit,
    imageDaily: entitlement.imageDailyLimit,
    imagePeriod: entitlement.imagePeriodLimit,
  },
  version: entitlement.version,
});

export class SupabaseEntitlementResolver {
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly now: () => Date = () => new Date(),
    client?: SupabaseClient,
  ) {
    this.client =
      client ??
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }

  async resolve(userId: string): Promise<AccountEntitlement> {
    const { data, error } = await this.client
      .from('account_entitlements')
      .select(
        'plan_key,source,subscription_status,action_daily_limit,action_period_limit,image_daily_limit,image_period_limit,max_boards,max_storage_bytes,max_concurrent_ai_tasks,model_quality_tier,unlimited,effective_until,version',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '账户权益服务暂时不可用');
    if (!data) return planEntitlement('free');
    try {
      const entitlement = fromRow(data);
      if (
        entitlement.effectiveUntil &&
        Date.parse(entitlement.effectiveUntil) <= this.now().getTime()
      ) {
        return planEntitlement('free');
      }
      return entitlement;
    } catch {
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '账户权益数据无效');
    }
  }
}
