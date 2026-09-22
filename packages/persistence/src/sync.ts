import { LocalPersistenceError, RevisionConflictError } from './errors';
import type { LocalBoardRepository } from './repository';
import type { OutboxOperation, StoredAsset, StoredBoard } from './schema';

export type SyncState =
  | 'clean'
  | 'local-saving'
  | 'dirty'
  | 'syncing-assets'
  | 'syncing-snapshot'
  | 'synced'
  | 'offline'
  | 'retrying'
  | 'conflict'
  | 'failed-local';

export interface RemoteBoardGateway {
  uploadAsset(asset: StoredAsset): Promise<void>;
  saveSnapshot(board: StoredBoard, expectedRevision: number): Promise<number>;
  deleteBoard(boardId: string): Promise<void>;
}

export interface SyncResult {
  boardId: string;
  state: SyncState;
  retryAt?: number;
}

export class BoardSyncEngine {
  private readonly running = new Map<string, Promise<SyncResult>>();
  private cloudWritesBlocked = false;

  constructor(
    private readonly repository: LocalBoardRepository,
    private readonly remote: RemoteBoardGateway,
    private readonly isOnline: () => boolean = () => navigator.onLine,
  ) {}

  get areCloudWritesBlocked(): boolean {
    return this.cloudWritesBlocked;
  }

  syncBoard(boardId: string): Promise<SyncResult> {
    const current = this.running.get(boardId);
    if (current) return current;
    const task = this.run(boardId).finally(() => this.running.delete(boardId));
    this.running.set(boardId, task);
    return task;
  }

  private async run(boardId: string): Promise<SyncResult> {
    if (this.cloudWritesBlocked) return { boardId, state: 'failed-local' };
    if (!this.isOnline()) return { boardId, state: 'offline' };

    try {
      const operations = await this.repository.getOutbox(boardId);
      const operation = operations.sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      )[0];
      if (!operation) return { boardId, state: 'clean' };
      if (operation.nextAttemptAt > Date.now()) {
        return { boardId, state: 'retrying', retryAt: operation.nextAttemptAt };
      }
      return await this.execute(operation);
    } catch (error) {
      if (error instanceof LocalPersistenceError) {
        this.cloudWritesBlocked = true;
        return { boardId, state: 'failed-local' };
      }
      throw error;
    }
  }

  private async execute(operation: OutboxOperation): Promise<SyncResult> {
    if (operation.operation === 'delete') {
      try {
        await this.remote.deleteBoard(operation.boardId);
        await this.repository.completeOperation(operation);
        return { boardId: operation.boardId, state: 'synced' };
      } catch {
        return this.retry(operation);
      }
    }
    if (operation.operation === 'migration') return this.retry(operation);

    const board = await this.repository.getBoard(operation.boardId);
    if (!board) {
      await this.repository.completeOperation(operation);
      return { boardId: operation.boardId, state: 'clean' };
    }
    try {
      const assets = await this.repository.getAssets(operation.boardId);
      const referencedIds = new Set(board.snapshot.assets.map(({ fileId }) => fileId));
      for (const asset of assets.filter(
        ({ fileId, uploadState }) => referencedIds.has(fileId) && uploadState !== 'uploaded',
      )) {
        await this.repository.markAssetState(asset.boardId, asset.fileId, 'uploading');
        try {
          await this.remote.uploadAsset(asset);
          await this.repository.markAssetState(asset.boardId, asset.fileId, 'uploaded');
        } catch (error) {
          await this.repository.markAssetState(asset.boardId, asset.fileId, 'failed');
          throw error;
        }
      }
      const remoteRevision = await this.remote.saveSnapshot(board, operation.baseRevision);
      await this.repository.completeSnapshot(operation, remoteRevision);
      return { boardId: operation.boardId, state: 'synced' };
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await this.repository.createConflictCopy(board, error.remoteRevision);
        await this.repository.completeOperation(operation);
        return { boardId: operation.boardId, state: 'conflict' };
      }
      return this.retry(operation);
    }
  }

  private async retry(operation: OutboxOperation): Promise<SyncResult> {
    const updated = await this.repository.scheduleRetry(operation);
    return { boardId: operation.boardId, state: 'retrying', retryAt: updated.nextAttemptAt };
  }
}
