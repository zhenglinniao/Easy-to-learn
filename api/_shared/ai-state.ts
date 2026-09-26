import type { QuotaStatus, TutorResponse } from '@easy-to-learn/domain';

import { ApiFault } from './fault.js';

export const GUEST_AI_DAILY_LIMIT = 3;
export const AUTHENTICATED_AI_DAILY_LIMIT = 10;
export const AI_MIN_INTERVAL_MS = 5 * 60 * 1_000;
export const AI_PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface QuotaLimits {
  actionDaily: 3 | 10;
  actionPeriod: 15 | 45;
  imageDaily: 1 | 2;
  imagePeriod: 3 | 20;
}

export const quotaLimitsForActor = (actorKey: string): QuotaLimits =>
  actorKey.startsWith('user:')
    ? {
        actionDaily: AUTHENTICATED_AI_DAILY_LIMIT,
        actionPeriod: 45,
        imageDaily: 2,
        imagePeriod: 20,
      }
    : {
        actionDaily: GUEST_AI_DAILY_LIMIT,
        actionPeriod: 15,
        imageDaily: 1,
        imagePeriod: 3,
      };

export interface QuotaGrant {
  quota: QuotaStatus;
  duplicateInFlight: boolean;
}

export interface ImageQuotaGrant {
  quota: QuotaStatus;
  granted: boolean;
  duplicate: boolean;
}

export interface AiStateStore {
  getCached(actorKey: string, requestId: string): Promise<TutorResponse['data'] | null>;
  status(actorKey: string, now: Date): Promise<QuotaStatus>;
  reserve(actorKey: string, requestId: string, now: Date): Promise<QuotaGrant>;
  refund(actorKey: string, requestId: string, now: Date): Promise<void>;
  reserveImages(
    actorKey: string,
    requestId: string,
    count: number,
    now: Date,
  ): Promise<ImageQuotaGrant>;
  refundImages(actorKey: string, requestId: string, now: Date): Promise<void>;
  cache(actorKey: string, requestId: string, data: TutorResponse['data'], now: Date): Promise<void>;
}

interface ActorState {
  actionDay: string;
  actionDailyUsed: number;
  actionPeriodStartedAt: number | null;
  actionPeriodUsed: number;
  imageDay: string;
  imageDailyUsed: number;
  imagePeriodStartedAt: number | null;
  imagePeriodUsed: number;
  lastAcceptedAt: number | null;
  reservations: Map<string, number>;
  imageReservations: Map<string, number>;
}

export const shanghaiDayWindow = (
  date: Date,
): { day: string; ttlSeconds: number; resetsAt: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const day = `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`;
  const resetMs = Date.UTC(get('year'), get('month') - 1, get('day') + 1) - 8 * 60 * 60 * 1_000;
  return {
    day,
    ttlSeconds: Math.max(1, Math.ceil((resetMs - date.getTime()) / 1_000)),
    resetsAt: new Date(resetMs).toISOString(),
  };
};

const periodResetAt = (startedAt: number | null): string | null =>
  startedAt === null ? null : new Date(startedAt + AI_PERIOD_MS).toISOString();

const quotaStatus = (actorKey: string, state: ActorState, now: Date): QuotaStatus => {
  const limits = quotaLimitsForActor(actorKey);
  const day = shanghaiDayWindow(now);
  const retryAt = (state.lastAcceptedAt ?? 0) + AI_MIN_INTERVAL_MS;
  const actionDailyRemaining = Math.max(0, limits.actionDaily - state.actionDailyUsed);
  const actionPeriodRemaining = Math.max(0, limits.actionPeriod - state.actionPeriodUsed);
  const imageDailyRemaining = Math.max(0, limits.imageDaily - state.imageDailyUsed);
  const imagePeriodRemaining = Math.max(0, limits.imagePeriod - state.imagePeriodUsed);
  const nextAllowedAt = retryAt > now.getTime() ? new Date(retryAt).toISOString() : null;

  return {
    dailyLimit: limits.actionDaily,
    remaining: actionDailyRemaining,
    nextAllowedAt,
    action: {
      dailyLimit: limits.actionDaily,
      dailyRemaining: actionDailyRemaining,
      periodLimit: limits.actionPeriod,
      periodRemaining: actionPeriodRemaining,
      nextAllowedAt,
      dailyResetsAt: day.resetsAt,
      periodResetsAt: periodResetAt(state.actionPeriodStartedAt),
    },
    image: {
      dailyLimit: limits.imageDaily,
      dailyRemaining: imageDailyRemaining,
      periodLimit: limits.imagePeriod,
      periodRemaining: imagePeriodRemaining,
      periodResetsAt: periodResetAt(state.imagePeriodStartedAt),
    },
    mode: imageDailyRemaining === 0 || imagePeriodRemaining === 0 ? 'vector_only' : 'full',
  };
};

export class MemoryAiStateStore implements AiStateStore {
  private readonly actors = new Map<string, ActorState>();
  private readonly cacheEntries = new Map<
    string,
    { expiresAt: number; data: TutorResponse['data'] }
  >();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  async getCached(actorKey: string, requestId: string): Promise<TutorResponse['data'] | null> {
    const entry = this.cacheEntries.get(`${actorKey}:${requestId}`);
    if (!entry || entry.expiresAt <= this.clock()) return null;
    return entry.data;
  }

  async status(actorKey: string, now: Date): Promise<QuotaStatus> {
    return quotaStatus(actorKey, this.ensureState(actorKey, now), now);
  }

  async reserve(actorKey: string, requestId: string, now: Date): Promise<QuotaGrant> {
    const state = this.ensureState(actorKey, now);
    const limits = quotaLimitsForActor(actorKey);
    if (state.reservations.has(requestId)) {
      return { quota: quotaStatus(actorKey, state, now), duplicateInFlight: true };
    }
    if (state.actionDailyUsed >= limits.actionDaily) {
      throw new ApiFault('DAILY_QUOTA_EXHAUSTED', '今日 AI 请求次数已用完', {
        dailyLimit: limits.actionDaily,
      });
    }
    if (state.actionPeriodUsed >= limits.actionPeriod) {
      throw new ApiFault('PERIOD_QUOTA_EXHAUSTED', '近 30 天 AI 请求额度已用完', {
        periodLimit: limits.actionPeriod,
      });
    }
    if (
      state.lastAcceptedAt !== null &&
      now.getTime() - state.lastAcceptedAt < AI_MIN_INTERVAL_MS
    ) {
      const retryAt = state.lastAcceptedAt + AI_MIN_INTERVAL_MS;
      throw new ApiFault('RATE_LIMITED', '每 5 分钟只能发起一次 AI 请求', {
        retryAfterSeconds: Math.ceil((retryAt - now.getTime()) / 1_000),
        nextAllowedAt: new Date(retryAt).toISOString(),
      });
    }
    state.actionDailyUsed += 1;
    state.actionPeriodUsed += 1;
    state.actionPeriodStartedAt ??= now.getTime();
    state.lastAcceptedAt = now.getTime();
    state.reservations.set(requestId, now.getTime());
    return { quota: quotaStatus(actorKey, state, now), duplicateInFlight: false };
  }

  async refund(actorKey: string, requestId: string, now: Date): Promise<void> {
    const state = this.ensureState(actorKey, now);
    if (!state.reservations.delete(requestId)) return;
    state.actionDailyUsed = Math.max(0, state.actionDailyUsed - 1);
    state.actionPeriodUsed = Math.max(0, state.actionPeriodUsed - 1);
    if (state.actionPeriodUsed === 0) state.actionPeriodStartedAt = null;
    const accepted = [...state.reservations.values()];
    state.lastAcceptedAt = accepted.length > 0 ? Math.max(...accepted) : null;
  }

  async reserveImages(
    actorKey: string,
    requestId: string,
    count: number,
    now: Date,
  ): Promise<ImageQuotaGrant> {
    if (!Number.isInteger(count) || count < 1) {
      throw new ApiFault('INVALID_INPUT', '插画额度必须是正整数');
    }
    const state = this.ensureState(actorKey, now);
    const limits = quotaLimitsForActor(actorKey);
    if (state.imageReservations.has(requestId)) {
      return { quota: quotaStatus(actorKey, state, now), granted: true, duplicate: true };
    }
    if (
      state.imageDailyUsed + count > limits.imageDaily ||
      state.imagePeriodUsed + count > limits.imagePeriod
    ) {
      return { quota: quotaStatus(actorKey, state, now), granted: false, duplicate: false };
    }
    state.imageDailyUsed += count;
    state.imagePeriodUsed += count;
    state.imagePeriodStartedAt ??= now.getTime();
    state.imageReservations.set(requestId, count);
    return { quota: quotaStatus(actorKey, state, now), granted: true, duplicate: false };
  }

  async refundImages(actorKey: string, requestId: string, now: Date): Promise<void> {
    const state = this.ensureState(actorKey, now);
    const count = state.imageReservations.get(requestId);
    if (!count) return;
    state.imageReservations.delete(requestId);
    state.imageDailyUsed = Math.max(0, state.imageDailyUsed - count);
    state.imagePeriodUsed = Math.max(0, state.imagePeriodUsed - count);
    if (state.imagePeriodUsed === 0) state.imagePeriodStartedAt = null;
  }

  async cache(
    actorKey: string,
    requestId: string,
    data: TutorResponse['data'],
    now: Date,
  ): Promise<void> {
    this.cacheEntries.set(`${actorKey}:${requestId}`, {
      expiresAt: now.getTime() + IDEMPOTENCY_TTL_MS,
      data,
    });
  }

  private ensureState(actorKey: string, now: Date): ActorState {
    const day = shanghaiDayWindow(now).day;
    let state = this.actors.get(actorKey);
    if (!state) {
      state = {
        actionDay: day,
        actionDailyUsed: 0,
        actionPeriodStartedAt: null,
        actionPeriodUsed: 0,
        imageDay: day,
        imageDailyUsed: 0,
        imagePeriodStartedAt: null,
        imagePeriodUsed: 0,
        lastAcceptedAt: null,
        reservations: new Map(),
        imageReservations: new Map(),
      };
      this.actors.set(actorKey, state);
    }
    if (state.actionDay !== day) {
      state.actionDay = day;
      state.actionDailyUsed = 0;
    }
    if (state.imageDay !== day) {
      state.imageDay = day;
      state.imageDailyUsed = 0;
    }
    if (
      state.actionPeriodStartedAt !== null &&
      now.getTime() >= state.actionPeriodStartedAt + AI_PERIOD_MS
    ) {
      state.actionPeriodStartedAt = null;
      state.actionPeriodUsed = 0;
    }
    if (
      state.imagePeriodStartedAt !== null &&
      now.getTime() >= state.imagePeriodStartedAt + AI_PERIOD_MS
    ) {
      state.imagePeriodStartedAt = null;
      state.imagePeriodUsed = 0;
    }
    return state;
  }
}
