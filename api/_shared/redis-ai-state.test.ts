import type { TutorResponse } from '@easy-to-learn/domain';
import { describe, expect, it, vi } from 'vitest';

import { RedisAiStateStore } from './redis-ai-state.js';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const now = new Date('2026-09-27T04:00:00.000Z');

const createRedis = () => {
  const values = new Map<string, unknown>();
  const redis = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
    pttl: vi.fn(async () => -2),
    eval: vi.fn(async (...args: unknown[]) => {
      void args;
      return [1, 1, 1, 0];
    }),
  };
  return { values, redis };
};

const cachedData = {
  requestId: 'request-1',
  result: {
    schemaVersion: 1,
    mode: 'hint',
    title: '提示',
    hintLevel: 3,
    steps: [1, 2, 3].map((hintLevel) => ({
      id: `hint-${hintLevel}`,
      title: `提示 ${hintLevel}`,
      hintLevel: hintLevel as 1 | 2 | 3,
      blocks: [{ type: 'paragraph' as const, text: `第 ${hintLevel} 级提示` }],
    })),
    metadata: {
      model: 'provider/model',
      promptVersion: 'v1',
      generatedAt: '2026-09-27T04:00:00.000Z',
    },
  },
  quota: {
    dailyLimit: 10,
    remaining: 9,
    nextAllowedAt: null,
    action: {
      dailyLimit: 10,
      dailyRemaining: 9,
      periodLimit: 45,
      periodRemaining: 44,
      nextAllowedAt: null,
      dailyResetsAt: '2026-09-27T16:00:00.000Z',
      periodResetsAt: null,
    },
    image: {
      dailyLimit: 2,
      dailyRemaining: 2,
      periodLimit: 20,
      periodRemaining: 20,
      periodResetsAt: null,
    },
    mode: 'full',
  },
} as TutorResponse['data'];

describe('RedisAiStateStore', () => {
  it('requires an exact 256-bit encryption key', () => {
    const { redis } = createRedis();
    expect(() => new RedisAiStateStore(redis as never, 'actor-secret', 'too-short')).toThrow(
      '32 字节 Base64',
    );
  });

  it('encrypts cached tutor output and removes corrupt ciphertext', async () => {
    const { redis, values } = createRedis();
    const store = new RedisAiStateStore(redis as never, 'actor-secret', encryptionKey);

    await store.cache('user:user-1', 'request-1', cachedData);
    const [key, encrypted] = [...values.entries()][0]!;
    expect(key).not.toContain('user-1');
    expect(encrypted).not.toContain('提示');
    await expect(store.getCached('user:user-1', 'request-1')).resolves.toEqual(cachedData);

    values.set(key, 'invalid-ciphertext');
    await expect(store.getCached('user:user-1', 'request-1')).resolves.toBeNull();
    expect(redis.del).toHaveBeenCalledWith(key);
  });

  it('removes authenticated cache entries that no longer satisfy the response contract', async () => {
    const { redis, values } = createRedis();
    const store = new RedisAiStateStore(redis as never, 'actor-secret', encryptionKey);

    await store.cache('user:user-1', 'request-1', {
      ...cachedData,
      quota: { ...cachedData.quota, remaining: 99 },
    } as TutorResponse['data']);
    const [key] = [...values.keys()];

    await expect(store.getCached('user:user-1', 'request-1')).resolves.toBeNull();
    expect(redis.del).toHaveBeenCalledWith(key);
  });

  it('never exposes the raw actor id in quota and reservation keys', async () => {
    const { redis } = createRedis();
    const store = new RedisAiStateStore(redis as never, 'actor-secret', encryptionKey);

    await store.reserve('user:sensitive-user-id', 'request-1', now);

    const [, keys] = redis.eval.mock.calls[0]!;
    expect(JSON.stringify(keys)).not.toContain('sensitive-user-id');
    expect(keys).toHaveLength(4);
    expect(redis.get).toHaveBeenCalled();
  });

  it.each([
    [-1, 'DAILY_QUOTA_EXHAUSTED'],
    [-2, 'PERIOD_QUOTA_EXHAUSTED'],
    [0, 'RATE_LIMITED'],
  ] as const)('maps atomic reservation status %i to %s', async (status, code) => {
    const { redis } = createRedis();
    redis.eval.mockResolvedValue([status, 3, 15, 42_000]);
    const store = new RedisAiStateStore(redis as never, 'actor-secret', encryptionKey);

    await expect(store.reserve('anonymous:guest-1', 'request-1', now)).rejects.toMatchObject({
      code,
    });
  });

  it('reports image quota exhaustion without incrementing counters again', async () => {
    const { redis } = createRedis();
    redis.eval.mockResolvedValue([-1, 1, 3]);
    const store = new RedisAiStateStore(redis as never, 'actor-secret', encryptionKey);

    await expect(
      store.reserveImages('anonymous:guest-1', 'image-2', 1, now),
    ).resolves.toMatchObject({
      granted: false,
      duplicate: false,
      quota: { image: { dailyRemaining: 1 } },
    });
  });

  it('uses a hashed Redis lock to deduplicate unmetered administrator work', async () => {
    const { redis } = createRedis();
    redis.eval.mockResolvedValueOnce([0]).mockResolvedValueOnce([1]);
    const store = new RedisAiStateStore(redis as never, 'actor-secret', encryptionKey);

    await expect(
      store.reserveUnmetered('user:admin-id', 'same-request', 'action', now),
    ).resolves.toBe(false);
    await expect(
      store.reserveUnmetered('user:admin-id', 'same-request', 'action', now),
    ).resolves.toBe(true);

    const [, rawKeys] = redis.eval.mock.calls[0]!;
    const keys = rawKeys as string[];
    expect(JSON.stringify(keys)).not.toContain('admin-id');
    expect(JSON.stringify(keys)).toContain('ai:unmetered:action:');
    await store.refundUnmetered('user:admin-id', 'same-request', 'action');
    expect(redis.del).toHaveBeenCalledWith(keys[0]);
  });
});
