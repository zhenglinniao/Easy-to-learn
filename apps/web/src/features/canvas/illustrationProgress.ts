export type IllustrationProgressStatus =
  | 'generating'
  | 'generated'
  | 'not_applicable'
  | 'unavailable'
  | 'quota_exhausted'
  | 'failed'
  | 'cancelled';

export const illustrationStatusLabel = (status?: IllustrationProgressStatus): string => {
  if (status === 'generating') return ' · 正在生成教学插画';
  if (status === 'generated') return ' · 插画已放入画布';
  if (status === 'not_applicable') return ' · 本题使用精确文字与矢量图解';
  if (status === 'unavailable') return ' · 生图模型尚未配置';
  if (status === 'quota_exhausted') return ' · 今日插画额度已用完';
  if (status === 'failed') return ' · 插画生成失败，文字与矢量图解已保留';
  if (status === 'cancelled') return ' · 已取消插画生成，文字与矢量图解已保留';
  return '';
};

export const updateMatchingIllustrationStatus = <
  Summary extends { requestId: string; illustrationStatus?: IllustrationProgressStatus },
>(
  summary: Summary | null,
  requestId: string,
  illustrationStatus: IllustrationProgressStatus,
): Summary | null =>
  summary?.requestId === requestId ? { ...summary, illustrationStatus } : summary;
