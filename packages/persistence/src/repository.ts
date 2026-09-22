import {
  assetManifestItemSchema,
  parsePersistedCanvas,
  type AssetManifestItem,
  type PersistedCanvasV2,
} from '@easy-to-learn/domain';

import { LocalPersistenceError, toLocalPersistenceError } from './errors';
import type { LocalDatabase } from './database';
import type {
  ConflictCopy,
  MigrationBackup,
  OutboxOperation,
  RawLocalDataExport,
  StoredAsset,
  StoredBoard,
} from './schema';

const sha256 = async (blob: Blob): Promise<string> => {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export class LocalBoardRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async putAsset(manifestInput: AssetManifestItem, blob: Blob): Promise<StoredAsset> {
    const manifest = assetManifestItemSchema.parse(manifestInput);
    const pathParts = manifest.objectPath.split('/');
    if (
      pathParts.length !== 3 ||
      !pathParts[0] ||
      !pathParts[1] ||
      pathParts[2] !== manifest.contentHash
    ) {
      throw new LocalPersistenceError(
        'ASSET_INTEGRITY_FAILED',
        '资产路径必须符合 <ownerId>/<boardId>/<contentHash>',
      );
    }
    if (blob.size !== manifest.byteSize || blob.type !== manifest.mimeType) {
      throw new LocalPersistenceError('ASSET_INTEGRITY_FAILED', '图片大小或 MIME 与资产清单不一致');
    }
    if ((await sha256(blob)) !== manifest.contentHash) {
      throw new LocalPersistenceError('ASSET_INTEGRITY_FAILED', '图片内容摘要校验失败');
    }

    const asset: StoredAsset = {
      boardId: pathParts[1],
      fileId: manifest.fileId,
      blob,
      contentHash: manifest.contentHash,
      mimeType: manifest.mimeType,
      byteSize: manifest.byteSize,
      width: manifest.width,
      height: manifest.height,
      uploadState: 'local',
      objectPath: manifest.objectPath,
    };
    try {
      await this.database.put('assets', asset);
      return asset;
    } catch (error) {
      throw toLocalPersistenceError(error);
    }
  }

  async saveDurableChange(snapshotInput: PersistedCanvasV2): Promise<StoredBoard> {
    const snapshot = parsePersistedCanvas(snapshotInput);
    const transaction = this.database.transaction(['boards', 'assets', 'outbox'], 'readwrite');
    try {
      for (const manifest of snapshot.assets) {
        const asset = await transaction
          .objectStore('assets')
          .get([snapshot.boardId, manifest.fileId]);
        if (!asset || asset.contentHash !== manifest.contentHash) {
          throw new LocalPersistenceError(
            'MISSING_ASSET',
            `快照引用的资产尚未安全落盘：${manifest.fileId}`,
          );
        }
      }

      const boards = transaction.objectStore('boards');
      const existing = await boards.get(snapshot.boardId);
      const board: StoredBoard = {
        boardId: snapshot.boardId,
        snapshot,
        localRevision: (existing?.localRevision ?? 0) + 1,
        remoteRevision: existing?.remoteRevision ?? snapshot.revision,
        dirty: true,
        updatedAt: this.now().toISOString(),
      };
      await boards.put(board);

      const outbox = transaction.objectStore('outbox');
      const snapshotKey = await outbox
        .index('by-board-operation')
        .getKey([snapshot.boardId, 'snapshot']);
      const operation: OutboxOperation = {
        ...(snapshotKey === undefined ? {} : { id: snapshotKey }),
        boardId: snapshot.boardId,
        baseRevision: board.remoteRevision,
        localRevision: board.localRevision,
        operation: 'snapshot',
        attempts: 0,
        nextAttemptAt: this.now().getTime(),
        createdAt: this.now().toISOString(),
      };
      await outbox.put(operation);
      await transaction.done;
      return board;
    } catch (error) {
      transaction.abort();
      await transaction.done.catch(() => undefined);
      throw toLocalPersistenceError(error);
    }
  }

  async storeRemoteSnapshot(snapshotInput: PersistedCanvasV2): Promise<StoredBoard> {
    const snapshot = parsePersistedCanvas(snapshotInput);
    const existing = await this.database.get('boards', snapshot.boardId);
    const board: StoredBoard = {
      boardId: snapshot.boardId,
      snapshot,
      localRevision: existing?.localRevision ?? 0,
      remoteRevision: snapshot.revision,
      dirty: false,
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.database.put('boards', board);
      return board;
    } catch (error) {
      throw toLocalPersistenceError(error);
    }
  }

  async queueDelete(boardId: string): Promise<void> {
    const transaction = this.database.transaction(['boards', 'outbox'], 'readwrite');
    try {
      const board = await transaction.objectStore('boards').get(boardId);
      const existingDeleteKey = await transaction
        .objectStore('outbox')
        .index('by-board-operation')
        .getKey([boardId, 'delete']);
      await transaction.objectStore('outbox').put({
        ...(existingDeleteKey === undefined ? {} : { id: existingDeleteKey }),
        boardId,
        baseRevision: board?.remoteRevision ?? 0,
        localRevision: board?.localRevision ?? 0,
        operation: 'delete',
        attempts: 0,
        nextAttemptAt: this.now().getTime(),
        createdAt: this.now().toISOString(),
      });
      const snapshotKey = await transaction
        .objectStore('outbox')
        .index('by-board-operation')
        .getKey([boardId, 'snapshot']);
      if (snapshotKey !== undefined) await transaction.objectStore('outbox').delete(snapshotKey);
      await transaction.objectStore('boards').delete(boardId);
      await transaction.done;
    } catch (error) {
      transaction.abort();
      await transaction.done.catch(() => undefined);
      throw toLocalPersistenceError(error);
    }
  }

  getBoard(boardId: string): Promise<StoredBoard | undefined> {
    return this.database.get('boards', boardId);
  }

  async listLocalBoards(): Promise<StoredBoard[]> {
    const boards = await this.database.getAll('boards');
    return boards
      .filter(({ boardId }) => boardId.startsWith('local_'))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async deleteLocalBoard(boardId: string): Promise<void> {
    if (!boardId.startsWith('local_')) {
      throw new LocalPersistenceError('DATABASE_CORRUPTED', '只能通过本地入口删除游客画板');
    }
    const transaction = this.database.transaction(
      ['boards', 'assets', 'outbox', 'conflictCopies'],
      'readwrite',
    );
    try {
      const [assetKeys, outboxKeys, conflictKeys] = await Promise.all([
        transaction.objectStore('assets').index('by-board').getAllKeys(boardId),
        transaction.objectStore('outbox').index('by-board').getAllKeys(boardId),
        transaction.objectStore('conflictCopies').index('by-board').getAllKeys(boardId),
      ]);
      await Promise.all([
        transaction.objectStore('boards').delete(boardId),
        ...assetKeys.map((key) => transaction.objectStore('assets').delete(key)),
        ...outboxKeys.map((key) => transaction.objectStore('outbox').delete(key)),
        ...conflictKeys.map((key) => transaction.objectStore('conflictCopies').delete(key)),
      ]);
      await transaction.done;
    } catch (error) {
      transaction.abort();
      await transaction.done.catch(() => undefined);
      throw toLocalPersistenceError(error);
    }
  }

  async clearAllLocalData(): Promise<void> {
    const transaction = this.database.transaction(
      ['boards', 'assets', 'outbox', 'preferences', 'migrationBackups', 'conflictCopies'],
      'readwrite',
    );
    try {
      await Promise.all([
        transaction.objectStore('boards').clear(),
        transaction.objectStore('assets').clear(),
        transaction.objectStore('outbox').clear(),
        transaction.objectStore('preferences').clear(),
        transaction.objectStore('migrationBackups').clear(),
        transaction.objectStore('conflictCopies').clear(),
      ]);
      await transaction.done;
    } catch (error) {
      transaction.abort();
      await transaction.done.catch(() => undefined);
      throw toLocalPersistenceError(error);
    }
  }

  async prepareGuestMigration(
    sourceBoardId: string,
    targetBoardId: string,
    ownerId: string,
  ): Promise<{ board: StoredBoard; markerId: number }> {
    if (!sourceBoardId.startsWith('local_') || targetBoardId.startsWith('local_')) {
      throw new LocalPersistenceError('DATABASE_CORRUPTED', '游客草稿迁移的画板 ID 无效');
    }
    const transaction = this.database.transaction(
      ['boards', 'assets', 'outbox', 'migrationBackups'],
      'readwrite',
    );
    try {
      const source = await transaction.objectStore('boards').get(sourceBoardId);
      if (!source) throw new LocalPersistenceError('DATABASE_CORRUPTED', '找不到待迁移的游客草稿');
      const assets = await transaction
        .objectStore('assets')
        .index('by-board')
        .getAll(sourceBoardId);
      const manifests = source.snapshot.assets.map((manifest) => ({
        ...manifest,
        objectPath: `${ownerId}/${targetBoardId}/${manifest.contentHash}`,
      }));
      const snapshot: PersistedCanvasV2 = {
        ...source.snapshot,
        boardId: targetBoardId,
        revision: 0,
        assets: manifests,
        updatedAt: this.now().toISOString(),
      };
      const board: StoredBoard = {
        boardId: targetBoardId,
        snapshot,
        localRevision: 1,
        remoteRevision: 0,
        dirty: true,
        updatedAt: this.now().toISOString(),
      };
      await transaction.objectStore('boards').put(board);
      for (const asset of assets) {
        await transaction.objectStore('assets').put({
          ...asset,
          boardId: targetBoardId,
          objectPath: `${ownerId}/${targetBoardId}/${asset.contentHash}`,
          uploadState: 'local',
        });
      }
      await transaction.objectStore('outbox').add({
        boardId: targetBoardId,
        baseRevision: 0,
        localRevision: 1,
        operation: 'migration',
        attempts: 0,
        nextAttemptAt: this.now().getTime(),
        createdAt: this.now().toISOString(),
      });
      const markerId = await transaction.objectStore('migrationBackups').add({
        rawData: { sourceBoardId, targetBoardId },
        source: `guest-board:${sourceBoardId}`,
        createdAt: this.now().toISOString(),
        cleanupAt: new Date(this.now().getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        status: 'pending',
      });
      await transaction.done;
      return { board, markerId };
    } catch (error) {
      transaction.abort();
      await transaction.done.catch(() => undefined);
      throw toLocalPersistenceError(error);
    }
  }

  async markMigration(markerId: number, status: MigrationBackup['status']): Promise<void> {
    const marker = await this.database.get('migrationBackups', markerId);
    if (marker) await this.database.put('migrationBackups', { ...marker, status });
  }

  async findGuestMigration(sourceBoardId: string): Promise<MigrationBackup | null> {
    const markers = await this.database.getAll('migrationBackups');
    return (
      markers
        .filter(({ source }) => source === `guest-board:${sourceBoardId}`)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
    );
  }

  async cleanupExpiredGuestMigrations(): Promise<number> {
    const markers = await this.database.getAll('migrationBackups');
    const expired = markers.filter(
      ({ source, status, cleanupAt, id }) =>
        id !== undefined &&
        source.startsWith('guest-board:local_') &&
        status === 'migrated' &&
        Date.parse(cleanupAt) <= this.now().getTime(),
    );
    for (const marker of expired) {
      const sourceBoardId = marker.source.slice('guest-board:'.length);
      await this.deleteLocalBoard(sourceBoardId);
      await this.database.delete('migrationBackups', marker.id!);
    }
    return expired.length;
  }

  getAssets(boardId: string): Promise<StoredAsset[]> {
    return this.database.getAllFromIndex('assets', 'by-board', boardId);
  }

  getOutbox(boardId: string): Promise<OutboxOperation[]> {
    return this.database.getAllFromIndex('outbox', 'by-board', boardId);
  }

  getDueOutbox(timestamp = this.now().getTime()): Promise<OutboxOperation[]> {
    return this.database.getAllFromIndex(
      'outbox',
      'by-next-attempt',
      IDBKeyRange.upperBound(timestamp),
    );
  }

  async markAssetState(
    boardId: string,
    fileId: string,
    uploadState: StoredAsset['uploadState'],
  ): Promise<void> {
    const transaction = this.database.transaction('assets', 'readwrite');
    const asset = await transaction.store.get([boardId, fileId]);
    if (asset) await transaction.store.put({ ...asset, uploadState });
    await transaction.done;
  }

  async completeSnapshot(operation: OutboxOperation, remoteRevision: number): Promise<boolean> {
    const transaction = this.database.transaction(['boards', 'outbox'], 'readwrite');
    const board = await transaction.objectStore('boards').get(operation.boardId);
    const isCurrent = board?.localRevision === operation.localRevision;
    if (board) {
      await transaction.objectStore('boards').put({
        ...board,
        remoteRevision,
        dirty: !isCurrent,
        snapshot: { ...board.snapshot, revision: remoteRevision },
      });
    }
    if (isCurrent && operation.id !== undefined) {
      await transaction.objectStore('outbox').delete(operation.id);
    } else if (!isCurrent) {
      const outbox = transaction.objectStore('outbox');
      const currentKey = await outbox
        .index('by-board-operation')
        .getKey([operation.boardId, 'snapshot']);
      if (currentKey !== undefined) {
        const currentOperation = await outbox.get(currentKey);
        if (currentOperation) {
          await outbox.put({ ...currentOperation, baseRevision: remoteRevision });
        }
      }
    }
    await transaction.done;
    return isCurrent;
  }

  async completeOperation(operation: OutboxOperation): Promise<void> {
    if (operation.id !== undefined) await this.database.delete('outbox', operation.id);
  }

  async scheduleRetry(operation: OutboxOperation): Promise<OutboxOperation> {
    const attempts = operation.attempts + 1;
    const delay = Math.min(1_000 * 2 ** Math.min(attempts - 1, 8), 300_000);
    const updated = { ...operation, attempts, nextAttemptAt: this.now().getTime() + delay };
    await this.database.put('outbox', updated);
    return updated;
  }

  async createConflictCopy(board: StoredBoard, remoteRevision: number): Promise<ConflictCopy> {
    const copy: ConflictCopy = {
      boardId: board.boardId,
      snapshot: board.snapshot,
      localRevision: board.localRevision,
      remoteRevision,
      createdAt: this.now().toISOString(),
    };
    const id = await this.database.add('conflictCopies', copy);
    return { ...copy, id };
  }

  getConflictCopies(boardId: string): Promise<ConflictCopy[]> {
    return this.database.getAllFromIndex('conflictCopies', 'by-board', boardId);
  }

  async addMigrationBackup(backup: Omit<MigrationBackup, 'id'>): Promise<number> {
    return this.database.add('migrationBackups', backup);
  }

  async exportRawData(): Promise<RawLocalDataExport> {
    const transaction = this.database.transaction(
      ['boards', 'assets', 'outbox', 'preferences', 'migrationBackups', 'conflictCopies'],
      'readonly',
    );
    const [boards, assets, outbox, preferences, migrationBackups, conflictCopies] =
      await Promise.all([
        transaction.objectStore('boards').getAll(),
        transaction.objectStore('assets').getAll(),
        transaction.objectStore('outbox').getAll(),
        transaction.objectStore('preferences').getAll(),
        transaction.objectStore('migrationBackups').getAll(),
        transaction.objectStore('conflictCopies').getAll(),
      ]);
    await transaction.done;
    return {
      format: 'easy-to-learn-local-backup',
      exportVersion: 1,
      exportedAt: this.now().toISOString(),
      boards,
      assets,
      outbox,
      preferences,
      migrationBackups,
      conflictCopies,
    };
  }
}
