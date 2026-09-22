import type { MigrationBackup, StoredBoard } from '@easy-to-learn/persistence';
import { describe, expect, it, vi } from 'vitest';

import { GuestBoardMigrationService, type GuestMigrationLocal } from './guest-migration';

const targetBoardId = '55555555-5555-4555-8555-555555555555';
const migratedBoard = { boardId: targetBoardId } as StoredBoard;

const setup = (marker: MigrationBackup | null = null) => {
  const local: GuestMigrationLocal = {
    findGuestMigration: vi.fn().mockResolvedValue(marker),
    prepareGuestMigration: vi.fn().mockResolvedValue({ board: migratedBoard, markerId: 7 }),
    markMigration: vi.fn().mockResolvedValue(undefined),
  };
  const remote = { create: vi.fn().mockResolvedValue({ boardId: targetBoardId }) };
  const sync = {
    syncBoard: vi.fn().mockResolvedValue({ boardId: targetBoardId, state: 'synced' }),
  };
  return { service: new GuestBoardMigrationService(local, remote, sync), local, remote, sync };
};

describe('GuestBoardMigrationService', () => {
  it('创建全新云画板、同步迁移副本并标记完成', async () => {
    const { service, local, remote, sync } = setup();

    await expect(service.migrate('local_guest', 'user-1')).resolves.toBe(targetBoardId);

    expect(remote.create).toHaveBeenCalledWith('游客草稿');
    expect(local.prepareGuestMigration).toHaveBeenCalledWith(
      'local_guest',
      targetBoardId,
      'user-1',
    );
    expect(sync.syncBoard).toHaveBeenCalledWith(targetBoardId);
    expect(local.markMigration).toHaveBeenCalledWith(7, 'migrated');
  });

  it('失败后复用迁移标记中的目标画板，不重复创建云画板', async () => {
    const marker: MigrationBackup = {
      id: 9,
      rawData: { sourceBoardId: 'local_guest', targetBoardId },
      source: 'guest-board:local_guest',
      createdAt: '2026-09-23T00:00:00.000Z',
      cleanupAt: '2026-09-30T00:00:00.000Z',
      status: 'failed',
    };
    const { service, local, remote, sync } = setup(marker);

    await expect(service.migrate('local_guest', 'user-1')).resolves.toBe(targetBoardId);

    expect(remote.create).not.toHaveBeenCalled();
    expect(local.prepareGuestMigration).not.toHaveBeenCalled();
    expect(sync.syncBoard).toHaveBeenCalledWith(targetBoardId);
    expect(local.markMigration).toHaveBeenCalledWith(9, 'migrated');
  });

  it('同步未完成时保留原稿并把标记设为失败', async () => {
    const { service, local, sync } = setup();
    vi.mocked(sync.syncBoard).mockResolvedValueOnce({
      boardId: targetBoardId,
      state: 'offline',
    });

    await expect(service.migrate('local_guest', 'user-1')).rejects.toThrow('游客草稿暂时无法同步');
    expect(local.markMigration).toHaveBeenCalledWith(7, 'failed');
  });
});
