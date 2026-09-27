import type { PersistedTutorBoardV2, QuotaStatus } from '@easy-to-learn/domain';
import { describe, expect, it } from 'vitest';

import { AI_FEEDBACK_WINDOW_MS, canSubmitFeedback, quotaBlockReason } from './canvasAccessPolicy';

const now = Date.parse('2026-09-27T06:00:00.000Z');

const quota = (action: Partial<QuotaStatus['action']> = {}): QuotaStatus => ({
  dailyLimit: 10,
  remaining: 9,
  nextAllowedAt: null,
  mode: 'full',
  action: {
    dailyLimit: 10,
    dailyRemaining: 9,
    periodLimit: 45,
    periodRemaining: 44,
    nextAllowedAt: null,
    dailyResetsAt: '2026-09-28T00:00:00.000Z',
    periodResetsAt: '2026-10-27T00:00:00.000Z',
    ...action,
  },
  image: {
    dailyLimit: 2,
    dailyRemaining: 2,
    periodLimit: 20,
    periodRemaining: 20,
    periodResetsAt: null,
  },
});

const board = (createdAt: string, requestId?: string) =>
  ({ createdAt, requestId }) as PersistedTutorBoardV2;

describe('canvas access policy', () => {
  it('管理员与尚未读取额度时不阻止 AI 请求', () => {
    expect(quotaBlockReason(null, now)).toBeNull();
    expect(quotaBlockReason({ ...quota(), unlimited: true }, now)).toBeNull();
  });

  it('分别说明日额度与 30 天额度耗尽', () => {
    expect(quotaBlockReason(quota({ dailyRemaining: 0 }), now)).toContain('10 次');
    expect(quotaBlockReason(quota({ periodRemaining: 0 }), now)).toContain('近 30 天');
  });

  it('把冷却时间向上取整并格式化为分秒', () => {
    expect(
      quotaBlockReason(quota({ nextAllowedAt: new Date(now + 61_001).toISOString() }), now),
    ).toBe('AI 正在休息，请等待 1:02。');
    expect(quotaBlockReason(quota({ nextAllowedAt: new Date(now).toISOString() }), now)).toBeNull();
    expect(quotaBlockReason(quota({ nextAllowedAt: 'invalid' }), now)).toBeNull();
  });

  it('反馈只在带请求编号的 24 小时窗口内开放', () => {
    const createdAt = new Date(now - AI_FEEDBACK_WINDOW_MS).toISOString();
    expect(canSubmitFeedback(board(createdAt, 'request-1'), now)).toBe(true);
    expect(canSubmitFeedback(board(createdAt, 'request-1'), now + 1)).toBe(false);
    expect(canSubmitFeedback(board(createdAt, undefined), now)).toBe(false);
    expect(canSubmitFeedback(board('invalid', 'request-1'), now)).toBe(false);
  });
});
