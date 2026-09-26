import type { SyncState } from '@easy-to-learn/persistence';

export const syncStateAfterNetworkChange = (state: SyncState, online: boolean): SyncState =>
  online && state === 'offline' ? 'dirty' : state;
