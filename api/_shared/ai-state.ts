import type { QuotaStatus, TutorResponse } from '@easy-to-learn/domain';

import { ApiFault } from './fault';

export const AI_DAILY_LIMIT = 3;
export const AI_MIN_INTERVAL_MS = 5 * 60 * 1_000;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface QuotaGrant {
  remaining: number;
  nextAllowedAt: string;
  duplicateInFlight: boolean;
}

export interface AiStateStore {
  getCached(actorKey: string, requestId: string): Promise<TutorResponse['data'] | null>;
  status(actorKey: string, now: Date): Promise<QuotaStatus>;
  reserve(actorKey: string, requestId: string, now: Date): Promise<QuotaGrant>;
  refund(actorKey: string, requestId: string, now: Date): Promise<void>;
  cache(actorKey: string, requestId: string, data: TutorResponse['data'], now: Date): Promise<void>;
}

interface ActorState {
  day: string;
  used: number;
  lastAcceptedAt: number | null;
  reservations: Map<string, number>;
}

const shanghaiDay = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

export class MemoryAiStateStore implements AiStateStore {
  private readonly actors = new Map<string, ActorState>();
  private readonly cacheEntries = new Map<
    string,
    { expiresAt: number; data: TutorResponse['data'] }
  >();

  async getCached(actorKey: string, requestId: string): Promise<TutorResponse['data'] | null> {
    const entry = this.cacheEntries.get(`${actorKey}:${requestId}`);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.data;
  }

  async status(actorKey: string, now: Date): Promise<QuotaStatus> {
    const state = this.actors.get(actorKey);
    if (!state || state.day !== shanghaiDay(now)) {
      return { dailyLimit: 3, remaining: 3, nextAllowedAt: null };
    }
    const retryAt = (state.lastAcceptedAt ?? 0) + AI_MIN_INTERVAL_MS;
    return {
      dailyLimit: 3,
      remaining: Math.max(0, AI_DAILY_LIMIT - state.used),
      nextAllowedAt: retryAt > now.getTime() ? new Date(retryAt).toISOString() : null,
    };
  }

  async reserve(actorKey: string, requestId: string, now: Date): Promise<QuotaGrant> {
    const day = shanghaiDay(now);
    let state = this.actors.get(actorKey);
    if (!state || state.day !== day) {
      state = { day, used: 0, lastAcceptedAt: null, reservations: new Map() };
      this.actors.set(actorKey, state);
    }
    if (state.reservations.has(requestId)) {
      return {
        remaining: Math.max(0, AI_DAILY_LIMIT - state.used),
        nextAllowedAt: new Date(
          (state.lastAcceptedAt ?? now.getTime()) + AI_MIN_INTERVAL_MS,
        ).toISOString(),
        duplicateInFlight: true,
      };
    }
    if (state.used >= AI_DAILY_LIMIT) {
      throw new ApiFault('QUOTA_EXCEEDED', '今日 AI 请求次数已用完', {
        dailyLimit: AI_DAILY_LIMIT,
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
    state.used += 1;
    state.lastAcceptedAt = now.getTime();
    state.reservations.set(requestId, now.getTime());
    return {
      remaining: AI_DAILY_LIMIT - state.used,
      nextAllowedAt: new Date(now.getTime() + AI_MIN_INTERVAL_MS).toISOString(),
      duplicateInFlight: false,
    };
  }

  async refund(actorKey: string, requestId: string): Promise<void> {
    const state = this.actors.get(actorKey);
    if (!state?.reservations.delete(requestId)) return;
    state.used = Math.max(0, state.used - 1);
    const accepted = [...state.reservations.values()];
    state.lastAcceptedAt = accepted.length > 0 ? Math.max(...accepted) : null;
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
}
