import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BroadcastSyncCoordinator } from './coordinator';

class FakeBroadcastChannel {
  static groups = new Map<string, Set<FakeBroadcastChannel>>();
  private listener?: (event: MessageEvent) => void;

  constructor(private readonly name: string) {
    const group = FakeBroadcastChannel.groups.get(name) ?? new Set();
    group.add(this);
    FakeBroadcastChannel.groups.set(name, group);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listener = listener;
  }

  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.groups.get(this.name) ?? []) {
      if (peer !== this) peer.listener?.({ data } as MessageEvent);
    }
  }

  close() {
    FakeBroadcastChannel.groups.get(this.name)?.delete(this);
  }
}

describe('BroadcastSyncCoordinator', () => {
  beforeEach(() => {
    FakeBroadcastChannel.groups.clear();
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('单标签页可取得并释放同步租约', async () => {
    const coordinator = new BroadcastSyncCoordinator('writer-a', 'test-single', 5_000, 0);
    const lease = await coordinator.acquire('board-1');

    expect(lease).toMatchObject({ boardId: 'board-1' });
    lease?.release();
    coordinator.close();
  });

  it('多标签页同时竞争时只允许 writerId 最小者写入', async () => {
    const first = new BroadcastSyncCoordinator('writer-a', 'test-race', 5_000, 1);
    const second = new BroadcastSyncCoordinator('writer-b', 'test-race', 5_000, 1);

    const [firstLease, secondLease] = await Promise.all([
      first.acquire('board-1'),
      second.acquire('board-1'),
    ]);

    expect(firstLease).not.toBeNull();
    expect(secondLease).toBeNull();
    firstLease?.release();
    await expect(second.acquire('board-1')).resolves.not.toBeNull();
    first.close();
    second.close();
  });
});
