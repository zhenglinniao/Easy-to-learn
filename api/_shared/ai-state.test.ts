import { describe, expect, it } from 'vitest';

import { AI_PERIOD_MS, MemoryAiStateStore } from './ai-state.js';

describe('AI quota state', () => {
  it('为游客和登录用户返回不同的 30 天及插画额度', async () => {
    const state = new MemoryAiStateStore();
    const now = new Date('2026-09-26T02:00:00.000Z');

    await expect(state.status('anonymous:guest-1', now)).resolves.toMatchObject({
      action: { dailyLimit: 3, periodLimit: 15, periodRemaining: 15 },
      image: { dailyLimit: 1, periodLimit: 3, periodRemaining: 3 },
      mode: 'full',
    });
    await expect(state.status('user:user-1', now)).resolves.toMatchObject({
      action: { dailyLimit: 10, dailyRemaining: 10, periodLimit: 45, periodRemaining: 45 },
      image: { dailyLimit: 2, periodLimit: 20, periodRemaining: 20 },
      mode: 'full',
    });
  });

  it('跨日累计游客 30 天额度并在固定窗口结束后恢复', async () => {
    const state = new MemoryAiStateStore();
    const actor = 'anonymous:guest-1';
    const startedAt = new Date('2026-09-01T00:00:00.000Z');
    let now = startedAt;

    for (let index = 0; index < 15; index += 1) {
      await state.reserve(actor, `request-${index}`, now);
      now = new Date(now.getTime() + (index % 3 === 2 ? 23 * 60 * 60 * 1_000 : 5 * 60 * 1_000));
    }

    await expect(state.status(actor, now)).resolves.toMatchObject({
      action: { periodRemaining: 0 },
    });
    await expect(state.reserve(actor, 'request-over-period', now)).rejects.toMatchObject({
      code: 'PERIOD_QUOTA_EXHAUSTED',
    });

    const afterReset = new Date(startedAt.getTime() + AI_PERIOD_MS);
    await expect(state.status(actor, afterReset)).resolves.toMatchObject({
      action: { periodRemaining: 15, periodResetsAt: null },
    });
  });

  it('独立原子预占插画额度，额度不足时降级并支持返还', async () => {
    const state = new MemoryAiStateStore();
    const actor = 'anonymous:guest-1';
    const now = new Date('2026-09-26T02:00:00.000Z');

    const first = await state.reserveImages(actor, 'image-request-1', 1, now);
    expect(first).toMatchObject({
      granted: true,
      duplicate: false,
      quota: { image: { dailyRemaining: 0, periodRemaining: 2 }, mode: 'vector_only' },
    });
    await expect(state.reserveImages(actor, 'image-request-1', 1, now)).resolves.toMatchObject({
      granted: true,
      duplicate: true,
    });
    await expect(state.reserveImages(actor, 'image-request-2', 1, now)).resolves.toMatchObject({
      granted: false,
      duplicate: false,
    });

    await state.refundImages(actor, 'image-request-1', now);
    await expect(state.status(actor, now)).resolves.toMatchObject({
      image: { dailyRemaining: 1, periodRemaining: 3, periodResetsAt: null },
      mode: 'full',
    });
  });

  it('失败请求全部返还后不提前开启 30 天窗口', async () => {
    const state = new MemoryAiStateStore();
    const actor = 'user:user-1';
    const now = new Date('2026-09-26T02:00:00.000Z');

    await state.reserve(actor, 'failed-request', now);
    await state.refund(actor, 'failed-request', now);

    await expect(state.status(actor, now)).resolves.toMatchObject({
      action: { dailyRemaining: 10, periodRemaining: 45, periodResetsAt: null },
    });
  });

  it('登录用户每天可使用 10 次，第 11 次被拒绝', async () => {
    const state = new MemoryAiStateStore();
    const actor = 'user:user-1';
    const startedAt = new Date('2026-09-26T00:00:00.000Z');

    for (let index = 0; index < 10; index += 1) {
      await expect(state.reserve(actor, `daily-${index}`, startedAt)).resolves.toMatchObject({
        duplicateInFlight: false,
        quota: { action: { nextAllowedAt: null } },
      });
    }

    await expect(state.status(actor, startedAt)).resolves.toMatchObject({
      dailyLimit: 10,
      remaining: 0,
      nextAllowedAt: null,
      action: { dailyLimit: 10, dailyRemaining: 0, nextAllowedAt: null },
    });
    await expect(state.reserve(actor, 'daily-over-limit', startedAt)).rejects.toMatchObject({
      code: 'DAILY_QUOTA_EXHAUSTED',
      details: { dailyLimit: 10 },
    });
  });

  it('游客仍需等待 5 分钟才能发起下一次请求', async () => {
    const state = new MemoryAiStateStore();
    const actor = 'anonymous:guest-1';
    const now = new Date('2026-09-26T00:00:00.000Z');

    await state.reserve(actor, 'guest-first', now);
    await expect(state.reserve(actor, 'guest-too-soon', now)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 300 },
    });
  });
});
