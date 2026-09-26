import { createHmac, randomUUID } from 'node:crypto';

export const ANALYTICS_COOKIE = 'etl_analytics';

export interface PublicProductMetrics {
  totalVisits: number;
  visitors30d: number;
  registeredUsers: number;
  cloudBoards: number;
  generatedAt: string;
}

const safeCount = (value: unknown): number => {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
};

export const validVisitorId = (value: string | undefined): value is string =>
  Boolean(value && /^[0-9a-f-]{36}$/.test(value));

export const createVisitorId = (): string => randomUUID();

export const hashVisitorId = (visitorId: string, secret: string): string =>
  createHmac('sha256', secret).update(`analytics:${visitorId}`).digest('hex');

export const serializeAnalyticsCookie = (visitorId: string): string =>
  `${ANALYTICS_COOKIE}=${visitorId}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`;

export const toPublicProductMetrics = (
  row: Record<string, unknown> | null | undefined,
  now = new Date(),
): PublicProductMetrics => ({
  totalVisits: safeCount(row?.total_visits),
  visitors30d: safeCount(row?.visitors_30d),
  registeredUsers: safeCount(row?.registered_users),
  cloudBoards: safeCount(row?.cloud_boards),
  generatedAt: now.toISOString(),
});
