import { deleteDB, openDB, type IDBPDatabase } from 'idb';

import { LocalPersistenceError } from './errors';
import { LOCAL_DATABASE_NAME, LOCAL_DATABASE_VERSION, type EasyToLearnDatabase } from './schema';

export type LocalDatabase = IDBPDatabase<EasyToLearnDatabase>;

export const openLocalDatabase = async (
  databaseName = LOCAL_DATABASE_NAME,
): Promise<LocalDatabase> => {
  try {
    return await openDB<EasyToLearnDatabase>(databaseName, LOCAL_DATABASE_VERSION, {
      upgrade(database) {
        const boards = database.createObjectStore('boards', { keyPath: 'boardId' });
        boards.createIndex('by-updated-at', 'updatedAt');

        const assets = database.createObjectStore('assets', {
          keyPath: ['boardId', 'fileId'],
        });
        assets.createIndex('by-board', 'boardId');
        assets.createIndex('by-upload-state', 'uploadState');

        const outbox = database.createObjectStore('outbox', {
          keyPath: 'id',
          autoIncrement: true,
        });
        outbox.createIndex('by-board', 'boardId');
        outbox.createIndex('by-board-operation', ['boardId', 'operation']);
        outbox.createIndex('by-next-attempt', 'nextAttemptAt');

        database.createObjectStore('preferences', { keyPath: 'key' });
        database.createObjectStore('migrationBackups', {
          keyPath: 'id',
          autoIncrement: true,
        });
        const conflicts = database.createObjectStore('conflictCopies', {
          keyPath: 'id',
          autoIncrement: true,
        });
        conflicts.createIndex('by-board', 'boardId');
      },
    });
  } catch (error) {
    throw new LocalPersistenceError('MIGRATION_FAILED', '无法初始化本地数据库', {
      cause: error,
    });
  }
};

export const safelyResetLocalDatabase = async (
  database: LocalDatabase,
  databaseName = LOCAL_DATABASE_NAME,
): Promise<void> => {
  database.close();
  await deleteDB(databaseName);
};
