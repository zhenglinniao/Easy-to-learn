import { describe, expect, it } from 'vitest';

import { syncStateAfterNetworkChange } from './syncResume';

describe('syncStateAfterNetworkChange', () => {
  it('resumes a previously offline sync after reconnecting', () => {
    expect(syncStateAfterNetworkChange('offline', true)).toBe('dirty');
  });

  it('does not disturb active or still-offline states', () => {
    expect(syncStateAfterNetworkChange('offline', false)).toBe('offline');
    expect(syncStateAfterNetworkChange('syncing-snapshot', true)).toBe('syncing-snapshot');
    expect(syncStateAfterNetworkChange('conflict', true)).toBe('conflict');
  });
});
