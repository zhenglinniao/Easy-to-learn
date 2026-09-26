import { describe, expect, it } from 'vitest';

import { syncStatusLabel } from './syncStatus';

describe('syncStatusLabel', () => {
  it('distinguishes offline state from server retry state', () => {
    expect(syncStatusLabel('offline', true)).toBe('离线 · 等待联网');
    expect(syncStatusLabel('retrying', true)).toBe('同步失败 · 自动重试');
  });

  it('keeps guest and durable local failure states explicit', () => {
    expect(syncStatusLabel('synced', false)).toBe('游客 · 仅本机');
    expect(syncStatusLabel('failed-local', true)).toBe('本地保存失败');
  });
});
