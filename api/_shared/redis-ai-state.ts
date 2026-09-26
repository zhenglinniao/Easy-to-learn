import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import type { QuotaStatus, TutorResponse } from '@easy-to-learn/domain';
import type { Redis } from '@upstash/redis';

import {
  AI_MIN_INTERVAL_MS,
  AI_PERIOD_MS,
  IDEMPOTENCY_TTL_MS,
  quotaLimitsForActor,
  shanghaiDayWindow,
  type AiStateStore,
  type ImageQuotaGrant,
  type QuotaGrant,
} from './ai-state.js';
import { ApiFault } from './fault.js';

const RESERVE_SCRIPT = `
local existing = redis.call('GET', KEYS[4])
local dailyUsed = tonumber(redis.call('GET', KEYS[1]) or '0')
local periodUsed = tonumber(redis.call('GET', KEYS[2]) or '0')
if existing then return {2, dailyUsed, periodUsed, redis.call('PTTL', KEYS[3])} end
if dailyUsed >= tonumber(ARGV[1]) then return {-1, dailyUsed, periodUsed, 0} end
if periodUsed >= tonumber(ARGV[2]) then return {-2, dailyUsed, periodUsed, 0} end
local rate = redis.call('GET', KEYS[3])
if rate then return {0, dailyUsed, periodUsed, redis.call('PTTL', KEYS[3])} end
dailyUsed = redis.call('INCR', KEYS[1])
if dailyUsed == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3])) end
periodUsed = redis.call('INCR', KEYS[2])
if periodUsed == 1 then redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[4])) end
redis.call('SET', KEYS[3], ARGV[5], 'PX', ARGV[6])
redis.call('SET', KEYS[4], '1', 'PX', ARGV[7])
return {1, dailyUsed, periodUsed, tonumber(ARGV[6])}
`;

const REFUND_SCRIPT = `
if redis.call('DEL', KEYS[4]) == 0 then return 0 end
local dailyUsed = tonumber(redis.call('GET', KEYS[1]) or '0')
local periodUsed = tonumber(redis.call('GET', KEYS[2]) or '0')
if dailyUsed > 0 then redis.call('DECR', KEYS[1]) end
if periodUsed > 1 then
  redis.call('DECR', KEYS[2])
elseif periodUsed == 1 then
  redis.call('DEL', KEYS[2])
end
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
return 1
`;

const RESERVE_IMAGES_SCRIPT = `
local existing = redis.call('GET', KEYS[3])
local dailyUsed = tonumber(redis.call('GET', KEYS[1]) or '0')
local periodUsed = tonumber(redis.call('GET', KEYS[2]) or '0')
if existing then return {2, dailyUsed, periodUsed} end
local count = tonumber(ARGV[1])
if dailyUsed + count > tonumber(ARGV[2]) then return {-1, dailyUsed, periodUsed} end
if periodUsed + count > tonumber(ARGV[3]) then return {-2, dailyUsed, periodUsed} end
dailyUsed = redis.call('INCRBY', KEYS[1], count)
if dailyUsed == count then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4])) end
periodUsed = redis.call('INCRBY', KEYS[2], count)
if periodUsed == count then redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5])) end
redis.call('SET', KEYS[3], count, 'PX', ARGV[6])
return {1, dailyUsed, periodUsed}
`;

const REFUND_IMAGES_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[3]) or '0')
if count == 0 then return 0 end
redis.call('DEL', KEYS[3])
local dailyUsed = tonumber(redis.call('GET', KEYS[1]) or '0')
local periodUsed = tonumber(redis.call('GET', KEYS[2]) or '0')
if dailyUsed > 0 then redis.call('DECRBY', KEYS[1], math.min(dailyUsed, count)) end
if periodUsed > count then
  redis.call('DECRBY', KEYS[2], count)
elseif periodUsed > 0 then
  redis.call('DEL', KEYS[2])
end
return count
`;

export class RedisAiStateStore implements AiStateStore {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly redis: Redis,
    private readonly actorHashSecret: string,
    encryptionKeyBase64: string,
  ) {
    this.encryptionKey = Buffer.from(encryptionKeyBase64, 'base64');
    if (this.encryptionKey.length !== 32) {
      throw new Error('AI_CACHE_ENCRYPTION_KEY 必须是 32 字节 Base64');
    }
  }

  async getCached(actorKey: string, requestId: string): Promise<TutorResponse['data'] | null> {
    const encrypted = await this.redis.get<string>(this.cacheKey(actorKey, requestId));
    if (!encrypted) return null;
    try {
      return JSON.parse(this.decrypt(encrypted)) as TutorResponse['data'];
    } catch {
      await this.redis.del(this.cacheKey(actorKey, requestId));
      return null;
    }
  }

  async status(actorKey: string, now: Date): Promise<QuotaStatus> {
    const day = shanghaiDayWindow(now);
    const keys = this.counterKeys(actorKey, day.day);
    const [
      actionDailyRaw,
      actionPeriodRaw,
      imageDailyRaw,
      imagePeriodRaw,
      retryMs,
      actionPeriodTtl,
      imagePeriodTtl,
    ] = await Promise.all([
      this.redis.get<number>(keys.actionDaily),
      this.redis.get<number>(keys.actionPeriod),
      this.redis.get<number>(keys.imageDaily),
      this.redis.get<number>(keys.imagePeriod),
      this.redis.pttl(keys.rate),
      this.redis.pttl(keys.actionPeriod),
      this.redis.pttl(keys.imagePeriod),
    ]);
    const limits = quotaLimitsForActor(actorKey);
    const actionDailyRemaining = Math.max(0, limits.actionDaily - Number(actionDailyRaw ?? 0));
    const actionPeriodRemaining = Math.max(0, limits.actionPeriod - Number(actionPeriodRaw ?? 0));
    const imageDailyRemaining = Math.max(0, limits.imageDaily - Number(imageDailyRaw ?? 0));
    const imagePeriodRemaining = Math.max(0, limits.imagePeriod - Number(imagePeriodRaw ?? 0));
    const nextAllowedAt = retryMs > 0 ? new Date(now.getTime() + retryMs).toISOString() : null;
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
        periodResetsAt:
          actionPeriodTtl > 0 ? new Date(now.getTime() + actionPeriodTtl).toISOString() : null,
      },
      image: {
        dailyLimit: limits.imageDaily,
        dailyRemaining: imageDailyRemaining,
        periodLimit: limits.imagePeriod,
        periodRemaining: imagePeriodRemaining,
        periodResetsAt:
          imagePeriodTtl > 0 ? new Date(now.getTime() + imagePeriodTtl).toISOString() : null,
      },
      mode: imageDailyRemaining === 0 || imagePeriodRemaining === 0 ? 'vector_only' : 'full',
    };
  }

  async reserve(actorKey: string, requestId: string, now: Date): Promise<QuotaGrant> {
    const day = shanghaiDayWindow(now);
    const limits = quotaLimitsForActor(actorKey);
    const keys = this.counterKeys(actorKey, day.day);
    const raw = await this.redis.eval(
      RESERVE_SCRIPT,
      [keys.actionDaily, keys.actionPeriod, keys.rate, this.reservationKey(actorKey, requestId)],
      [
        limits.actionDaily,
        limits.actionPeriod,
        day.ttlSeconds,
        AI_PERIOD_MS,
        requestId,
        AI_MIN_INTERVAL_MS,
        IDEMPOTENCY_TTL_MS,
      ],
    );
    const [status, , , retryMs] = (raw as Array<number | string>).map(Number);
    if (status === -1) {
      throw new ApiFault('DAILY_QUOTA_EXHAUSTED', '今日 AI 请求次数已用完', {
        dailyLimit: limits.actionDaily,
      });
    }
    if (status === -2) {
      throw new ApiFault('PERIOD_QUOTA_EXHAUSTED', '近 30 天 AI 请求额度已用完', {
        periodLimit: limits.actionPeriod,
      });
    }
    if (status === 0) {
      throw new ApiFault('RATE_LIMITED', '每 5 分钟只能发起一次 AI 请求', {
        retryAfterSeconds: Math.max(1, Math.ceil((retryMs ?? 0) / 1_000)),
        nextAllowedAt: new Date(now.getTime() + Math.max(0, retryMs ?? 0)).toISOString(),
      });
    }
    return {
      quota: await this.status(actorKey, now),
      duplicateInFlight: status === 2,
    };
  }

  async refund(actorKey: string, requestId: string, now: Date): Promise<void> {
    const day = shanghaiDayWindow(now);
    const keys = this.counterKeys(actorKey, day.day);
    await this.redis.eval(
      REFUND_SCRIPT,
      [keys.actionDaily, keys.actionPeriod, keys.rate, this.reservationKey(actorKey, requestId)],
      [requestId],
    );
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
    const day = shanghaiDayWindow(now);
    const limits = quotaLimitsForActor(actorKey);
    const keys = this.counterKeys(actorKey, day.day);
    const raw = await this.redis.eval(
      RESERVE_IMAGES_SCRIPT,
      [keys.imageDaily, keys.imagePeriod, this.imageReservationKey(actorKey, requestId)],
      [
        count,
        limits.imageDaily,
        limits.imagePeriod,
        day.ttlSeconds,
        AI_PERIOD_MS,
        IDEMPOTENCY_TTL_MS,
      ],
    );
    const [status] = (raw as Array<number | string>).map(Number);
    return {
      quota: await this.status(actorKey, now),
      granted: status === 1 || status === 2,
      duplicate: status === 2,
    };
  }

  async refundImages(actorKey: string, requestId: string, now: Date): Promise<void> {
    const day = shanghaiDayWindow(now);
    const keys = this.counterKeys(actorKey, day.day);
    await this.redis.eval(
      REFUND_IMAGES_SCRIPT,
      [keys.imageDaily, keys.imagePeriod, this.imageReservationKey(actorKey, requestId)],
      [],
    );
  }

  async cache(actorKey: string, requestId: string, data: TutorResponse['data']): Promise<void> {
    await this.redis.set(this.cacheKey(actorKey, requestId), this.encrypt(JSON.stringify(data)), {
      px: IDEMPOTENCY_TTL_MS,
    });
  }

  private actorHash(actorKey: string): string {
    return createHmac('sha256', this.actorHashSecret).update(actorKey).digest('hex');
  }

  private counterKeys(actorKey: string, day: string) {
    const actor = this.actorHash(actorKey);
    return {
      // 沿用旧键，避免发布当天为已经用过额度的用户意外重置日计数。
      actionDaily: `ai:daily:${actor}:${day}`,
      actionPeriod: `ai:action:period:${actor}`,
      imageDaily: `ai:image:day:${actor}:${day}`,
      imagePeriod: `ai:image:period:${actor}`,
      rate: `ai:rate:${actor}`,
    };
  }

  private reservationKey(actorKey: string, requestId: string): string {
    return `ai:reservation:${this.actorHash(actorKey)}:${requestId}`;
  }

  private imageReservationKey(actorKey: string, requestId: string): string {
    return `ai:image-reservation:${this.actorHash(actorKey)}:${requestId}`;
  }

  private cacheKey(actorKey: string, requestId: string): string {
    return `ai:result:${this.actorHash(actorKey)}:${requestId}`;
  }

  private encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }

  private decrypt(payload: string): string {
    const bytes = Buffer.from(payload, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
}
