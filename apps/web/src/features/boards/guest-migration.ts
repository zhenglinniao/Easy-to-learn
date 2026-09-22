import type { MigrationBackup, StoredBoard, SyncResult } from '@easy-to-learn/persistence';

export interface GuestMigrationRemote {
  create(title?: string): Promise<{ boardId: string }>;
}

export interface GuestMigrationLocal {
  findGuestMigration(sourceBoardId: string): Promise<MigrationBackup | null>;
  prepareGuestMigration(
    sourceBoardId: string,
    targetBoardId: string,
    ownerId: string,
  ): Promise<{ board: StoredBoard; markerId: number }>;
  markMigration(markerId: number, status: MigrationBackup['status']): Promise<void>;
}

export interface GuestMigrationSync {
  syncBoard(boardId: string): Promise<SyncResult>;
}

const targetFromMarker = (rawData: unknown): string | null => {
  if (!rawData || typeof rawData !== 'object' || !('targetBoardId' in rawData)) return null;
  const target = rawData.targetBoardId;
  return typeof target === 'string' && !target.startsWith('local_') ? target : null;
};

export class GuestBoardMigrationService {
  constructor(
    private readonly local: GuestMigrationLocal,
    private readonly remote: GuestMigrationRemote,
    private readonly sync: GuestMigrationSync,
  ) {}

  async migrate(sourceBoardId: string, ownerId: string): Promise<string> {
    const existing = await this.local.findGuestMigration(sourceBoardId);
    let targetBoardId = existing ? targetFromMarker(existing.rawData) : null;
    let markerId = existing?.id;

    if (!targetBoardId || markerId === undefined) {
      const created = await this.remote.create('游客草稿');
      const prepared = await this.local.prepareGuestMigration(
        sourceBoardId,
        created.boardId,
        ownerId,
      );
      targetBoardId = created.boardId;
      markerId = prepared.markerId;
    }

    const result = await this.sync.syncBoard(targetBoardId);
    if (result.state !== 'synced' && result.state !== 'clean') {
      await this.local.markMigration(markerId, 'failed');
      throw new Error('游客草稿暂时无法同步，原稿仍安全保留在本机。');
    }
    await this.local.markMigration(markerId, 'migrated');
    return targetBoardId;
  }
}
