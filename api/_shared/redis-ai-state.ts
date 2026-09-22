import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import type { QuotaStatus, TutorResponse } from '@easy-to-learn/domain';
import type { Redis } from '@upstash/redis';

import {
  AI_DAILY_LIMIT,
  AI_MIN_INTERVAL_MS,
  IDEMPOTENCY_TTL_MS,
  type AiStateStore,
  type QuotaGrant,
} from './ai-state';
import { ApiFault } from './fault';

const RESERVE_SCRIPT = `
local existing = redis.call('GET', KEYS[3])
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if existing then return {2, used, redis.call('PTTL', KEYS[2])} end
local rate = redis.call('GET', KEYS[2])
if rate then return {0, used, redis.call('PTTL', KEYS[2])} end
if used >= tonumber(ARGV[1]) then return {-1, used, 0} end
used = redis.call('INCR', KEYS[1])
if used == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
redis.call('SET', KEYS[3], '1', 'PX', ARGV[5])
return {1, used, tonumber(ARGV[4])}
`;

const REFUND_SCRIPT = `
if redis.call('DEL', KEYS[3]) == 0 then return 0 end
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used > 0 then redis.call('DECR', KEYS[1]) end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;

const shanghaiDayAndTtl = (now: Date): { day: string; ttlSeconds: number } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const day = `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`;
  const nextMidnightUtc =
    Date.UTC(get('year'), get('month') - 1, get('day') + 1) - 8 * 60 * 60 * 1_000;
  return { day, ttlSeconds: Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / 1_000)) };
};

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
    const { day } = shanghaiDayAndTtl(now);
    const [dailyKey, rateKey] = this.keys(actorKey, 'status', day);
    const [usedRaw, retryMs] = await Promise.all([
      this.redis.get<number>(dailyKey),
      this.redis.pttl(rateKey),
    ]);
    const used = Number(usedRaw ?? 0);
    return {
      dailyLimit: 3,
      remaining: Math.max(0, AI_DAILY_LIMIT - used),
      nextAllowedAt: retryMs > 0 ? new Date(now.getTime() + retryMs).toISOString() : null,
    };
  }

  async reserve(actorKey: string, requestId: string, now: Date): Promise<QuotaGrant> {
    const { day, ttlSeconds } = shanghaiDayAndTtl(now);
    const keys = this.keys(actorKey, requestId, day);
    const raw = await this.redis.eval(RESERVE_SCRIPT, keys, [
      AI_DAILY_LIMIT,
      ttlSeconds,
      requestId,
      AI_MIN_INTERVAL_MS,
      IDEMPOTENCY_TTL_MS,
    ]);
    const [status, used, retryMs] = (raw as Array<number | string>).map(Number);
    if (status === -1) {
      throw new ApiFault('QUOTA_EXCEEDED', '今日 AI 请求次数已用完', {
        dailyLimit: AI_DAILY_LIMIT,
      });
    }
    if (status === 0) {
      throw new ApiFault('RATE_LIMITED', '每 5 分钟只能发起一次 AI 请求', {
        retryAfterSeconds: Math.max(1, Math.ceil((retryMs ?? 0) / 1_000)),
        nextAllowedAt: new Date(now.getTime() + Math.max(0, retryMs ?? 0)).toISOString(),
      });
    }
    return {
      remaining: Math.max(0, AI_DAILY_LIMIT - (used ?? 0)),
      nextAllowedAt: new Date(now.getTime() + Math.max(0, retryMs ?? 0)).toISOString(),
      duplicateInFlight: status === 2,
    };
  }

  async refund(actorKey: string, requestId: string, now: Date): Promise<void> {
    const { day } = shanghaiDayAndTtl(now);
    await this.redis.eval(REFUND_SCRIPT, this.keys(actorKey, requestId, day), [requestId]);
  }

  async cache(actorKey: string, requestId: string, data: TutorResponse['data']): Promise<void> {
    await this.redis.set(this.cacheKey(actorKey, requestId), this.encrypt(JSON.stringify(data)), {
      px: IDEMPOTENCY_TTL_MS,
    });
  }

  private actorHash(actorKey: string): string {
    return createHmac('sha256', this.actorHashSecret).update(actorKey).digest('hex');
  }

  private keys(actorKey: string, requestId: string, day: string): [string, string, string] {
    const actor = this.actorHash(actorKey);
    return [`ai:daily:${actor}:${day}`, `ai:rate:${actor}`, `ai:reservation:${actor}:${requestId}`];
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
