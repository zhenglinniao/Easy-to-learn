import type { PersistedCanvasV2 } from '@easy-to-learn/domain';
import type { DBSchema } from 'idb';

export const LOCAL_DATABASE_NAME = 'easy-to-learn';
export const LOCAL_DATABASE_VERSION = 1;

export type AssetUploadState = 'local' | 'uploading' | 'uploaded' | 'failed';
export type OutboxOperationType = 'snapshot' | 'delete' | 'migration';

export interface StoredBoard {
  boardId: string;
  snapshot: PersistedCanvasV2;
  localRevision: number;
  remoteRevision: number;
  dirty: boolean;
  updatedAt: string;
}

export interface StoredAsset {
  boardId: string;
  fileId: string;
  blob: Blob;
  contentHash: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  width: number;
  height: number;
  uploadState: AssetUploadState;
  objectPath: string;
}

export interface OutboxOperation {
  id?: number;
  boardId: string;
  baseRevision: number;
  localRevision: number;
  operation: OutboxOperationType;
  attempts: number;
  nextAttemptAt: number;
  createdAt: string;
}

export interface StoredPreference {
  key: string;
  value: unknown;
}

export interface MigrationBackup {
  id?: number;
  rawData: unknown;
  source: string;
  createdAt: string;
  cleanupAt: string;
  status: 'pending' | 'migrated' | 'failed';
}

export interface ConflictCopy {
  id?: number;
  boardId: string;
  snapshot: PersistedCanvasV2;
  localRevision: number;
  remoteRevision: number;
  createdAt: string;
}

export interface EasyToLearnDatabase extends DBSchema {
  boards: {
    key: string;
    value: StoredBoard;
    indexes: { 'by-updated-at': string };
  };
  assets: {
    key: [string, string];
    value: StoredAsset;
    indexes: { 'by-board': string; 'by-upload-state': AssetUploadState };
  };
  outbox: {
    key: number;
    value: OutboxOperation;
    indexes: {
      'by-board': string;
      'by-board-operation': [string, OutboxOperationType];
      'by-next-attempt': number;
    };
  };
  preferences: {
    key: string;
    value: StoredPreference;
  };
  migrationBackups: {
    key: number;
    value: MigrationBackup;
  };
  conflictCopies: {
    key: number;
    value: ConflictCopy;
    indexes: { 'by-board': string };
  };
}

export interface RawLocalDataExport {
  format: 'easy-to-learn-local-backup';
  exportVersion: 1;
  exportedAt: string;
  boards: StoredBoard[];
  assets: StoredAsset[];
  outbox: OutboxOperation[];
  preferences: StoredPreference[];
  migrationBackups: MigrationBackup[];
  conflictCopies: ConflictCopy[];
}
