import type { SyncState } from '@easy-to-learn/persistence';

export const syncStatusLabel = (state: SyncState, isUser: boolean): string => {
  if (!isUser) return '游客 · 仅本机';
  if (state === 'synced' || state === 'clean') return '已保存到云端';
  if (state === 'local-saving') return '正在本地保存';
  if (state === 'syncing-assets' || state === 'syncing-snapshot') return '正在同步';
  if (state === 'conflict') return '版本冲突 · 已保留副本';
  if (state === 'offline') return '离线 · 等待联网';
  if (state === 'retrying') return '同步失败 · 自动重试';
  if (state === 'failed-local') return '本地保存失败';
  return '已保存本机 · 待同步';
};
