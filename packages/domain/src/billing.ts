import { z } from 'zod';

import { isoDateTimeSchema, nonNegativeIntegerSchema } from './common.js';
import { createDataResponseSchema, quotaStatusSchema } from './api.js';

export const subscriptionPlanSchema = z.enum(['free', 'plus', 'pro']);
export const subscriptionStatusSchema = z.enum([
  'none',
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'paused',
  'unpaid',
  'canceled',
  'incomplete_expired',
]);
export const entitlementSourceSchema = z.enum(['free', 'subscription', 'admin_override']);
export const modelQualityTierSchema = z.enum(['standard', 'enhanced', 'premium']);

export const accountEntitlementSchema = z.strictObject({
  plan: subscriptionPlanSchema,
  source: entitlementSourceSchema,
  subscriptionStatus: subscriptionStatusSchema,
  actionDailyLimit: z.number().int().positive().max(100_000),
  actionPeriodLimit: z.number().int().positive().max(1_000_000),
  imageDailyLimit: z.number().int().positive().max(10_000),
  imagePeriodLimit: z.number().int().positive().max(100_000),
  maxBoards: z.number().int().positive().max(100_000),
  maxStorageBytes: z.number().int().positive(),
  maxConcurrentAiTasks: z.number().int().positive().max(100),
  modelQualityTier: modelQualityTierSchema,
  unlimited: z.boolean(),
  effectiveUntil: isoDateTimeSchema.nullable(),
  version: z.number().int().nonnegative(),
});

export const billingSummarySchema = z.strictObject({
  configured: z.boolean(),
  entitlement: accountEntitlementSchema,
  quota: quotaStatusSchema,
  subscription: z
    .strictObject({
      status: subscriptionStatusSchema,
      cancelAtPeriodEnd: z.boolean(),
      currentPeriodEnd: isoDateTimeSchema.nullable(),
    })
    .nullable(),
  usage: z.strictObject({
    boards: nonNegativeIntegerSchema,
    storageBytes: nonNegativeIntegerSchema,
  }),
});

export const billingSummaryResponseSchema = createDataResponseSchema(billingSummarySchema);

export const checkoutRequestSchema = z.strictObject({
  plan: z.enum(['plus', 'pro']),
});

export const billingRedirectResponseSchema = createDataResponseSchema(
  z.strictObject({ url: z.url() }),
);

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type AccountEntitlement = z.infer<typeof accountEntitlementSchema>;
export type BillingSummary = z.infer<typeof billingSummarySchema>;
