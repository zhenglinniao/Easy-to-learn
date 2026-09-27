import type { PersistedTutorBoardV2, QuotaStatus } from '@easy-to-learn/domain';

export const AI_FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const canSubmitFeedback = (board: PersistedTutorBoardV2, now = Date.now()): boolean => {
  if (!board.requestId) return false;
  const createdAt = Date.parse(board.createdAt);
  return Number.isFinite(createdAt) && now <= createdAt + AI_FEEDBACK_WINDOW_MS;
};

export const quotaBlockReason = (quota: QuotaStatus | null, now: number): string | null => {
  if (!quota || quota.unlimited) return null;
  if (quota.action.dailyRemaining === 0) {
    return `今天的 ${quota.action.dailyLimit} 次 AI 额度已用完，明天再来吧。`;
  }
  if (quota.action.periodRemaining === 0) {
    return '近 30 天 AI 额度已用完，请在额度恢复后再试。';
  }
  const nextAllowed = quota.action.nextAllowedAt
    ? Date.parse(quota.action.nextAllowedAt)
    : Number.NaN;
  if (!Number.isFinite(nextAllowed) || nextAllowed <= now) return null;
  const seconds = Math.max(1, Math.ceil((nextAllowed - now) / 1_000));
  return `AI 正在休息，请等待 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}。`;
};
