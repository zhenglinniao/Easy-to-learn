import 'fake-indexeddb/auto';

import type { PersistedCanvasV2 } from '@easy-to-learn/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openLocalDatabase, safelyResetLocalDatabase, type LocalDatabase } from './database';
import { LocalPersistenceError, RevisionConflictError } from './errors';
import { LocalBoardRepository } from './repository';
import type { RemoteBoardGateway } from './sync';
import { BoardSyncEngine } from './sync';

const now = new Date('2026-09-22T00:00:00.000Z');
const databases: Array<{ database: LocalDatabase; name: string }> = [];

const emptySnapshot = (boardId = 'board-1'): PersistedCanvasV2 => ({
  schemaVersion: 2,
  boardId,
  revision: 0,
  excalidraw: {
    elements: [],
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null,
      gridStep: 20,
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
    },
  },
  assets: [],
  tutorBoards: [],
  updatedAt: now.toISOString(),
});

const createRepository = async () => {
  const name = `easy-to-learn-test-${crypto.randomUUID()}`;
  const database = await openLocalDatabase(name);
  databases.push({ database, name });
  return { repository: new LocalBoardRepository(database, () => now), database };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    databases.splice(0).map(({ database, name }) => safelyResetLocalDatabase(database, name)),
  );
});

describe('LocalBoardRepository', () => {
  it('缓存远端快照时保持干净状态且不创建 outbox', async () => {
    const { repository } = await createRepository();
    const remoteSnapshot = { ...emptySnapshot(), revision: 6 };

    await expect(repository.storeRemoteSnapshot(remoteSnapshot)).resolves.toMatchObject({
      remoteRevision: 6,
      dirty: false,
      snapshot: { revision: 6 },
    });
    expect(await repository.getOutbox('board-1')).toEqual([]);
  });

  it('在同一事务保存画板并把同画板快照任务合并为一个', async () => {
    const { repository } = await createRepository();

    const first = await repository.saveDurableChange(emptySnapshot());
    const second = await repository.saveDurableChange({
      ...emptySnapshot(),
      updatedAt: '2026-09-22T00:01:00.000Z',
    });

    expect(first.localRevision).toBe(1);
    expect(second.localRevision).toBe(2);
    expect(second.dirty).toBe(true);
    expect(await repository.getOutbox('board-1')).toEqual([
      expect.objectContaining({
        operation: 'snapshot',
        baseRevision: 0,
        localRevision: 2,
        attempts: 0,
      }),
    ]);
  });

  it('资产未先落盘时拒绝快照，且不留下半完成画板', async () => {
    const { repository } = await createRepository();
    const snapshot: PersistedCanvasV2 = {
      ...emptySnapshot(),
      assets: [
        {
          fileId: 'file-1',
          objectPath: `owner-1/board-1/${'a'.repeat(64)}`,
          contentHash: 'a'.repeat(64),
          mimeType: 'image/png',
          byteSize: 1,
          width: 1,
          height: 1,
        },
      ],
    };

    await expect(repository.saveDurableChange(snapshot)).rejects.toMatchObject({
      code: 'MISSING_ASSET',
    });
    expect(await repository.getBoard('board-1')).toBeUndefined();
    expect(await repository.getOutbox('board-1')).toEqual([]);
  });

  it('删除任务不会被快照合并覆盖', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot());

    await repository.queueDelete('board-1');

    expect(await repository.getBoard('board-1')).toBeUndefined();
    expect(await repository.getOutbox('board-1')).toEqual([
      expect.objectContaining({ operation: 'delete', localRevision: 1 }),
    ]);
  });

  it('校验资产摘要并保证资产先于引用它的快照落盘', async () => {
    const { repository } = await createRepository();
    const contentHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const blob = new Blob(['hello'], { type: 'image/png' });
    const manifest = {
      fileId: 'file-1',
      objectPath: `owner-1/board-1/${contentHash}`,
      contentHash,
      mimeType: 'image/png' as const,
      byteSize: blob.size,
      width: 1,
      height: 1,
    };

    await repository.putAsset(manifest, blob);
    await expect(
      repository.saveDurableChange({ ...emptySnapshot(), assets: [manifest] }),
    ).resolves.toMatchObject({ boardId: 'board-1', dirty: true });
    expect(await repository.getAssets('board-1')).toEqual([
      expect.objectContaining({ fileId: 'file-1', uploadState: 'local' }),
    ]);
  });

  it('可导出所有本地恢复数据', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot());

    const exported = await repository.exportRawData();

    expect(exported).toMatchObject({
      format: 'easy-to-learn-local-backup',
      exportVersion: 1,
      boards: [expect.objectContaining({ boardId: 'board-1' })],
      outbox: [expect.objectContaining({ operation: 'snapshot' })],
    });
  });

  it('游客草稿迁移为全新云画板并保留 7 天恢复标记', async () => {
    const { repository, database } = await createRepository();
    await repository.saveDurableChange(emptySnapshot('local_guest-1'));

    const migration = await repository.prepareGuestMigration(
      'local_guest-1',
      '33333333-3333-4333-8333-333333333333',
      'user-1',
    );

    expect(migration.board).toMatchObject({
      boardId: '33333333-3333-4333-8333-333333333333',
      remoteRevision: 0,
      dirty: true,
      snapshot: { boardId: '33333333-3333-4333-8333-333333333333', revision: 0 },
    });
    expect(await repository.getBoard('local_guest-1')).toBeDefined();
    expect(await repository.getOutbox(migration.board.boardId)).toEqual([
      expect.objectContaining({ operation: 'migration', baseRevision: 0 }),
    ]);
    expect(await database.get('migrationBackups', migration.markerId)).toMatchObject({
      source: 'guest-board:local_guest-1',
      cleanupAt: '2026-09-29T00:00:00.000Z',
      status: 'pending',
    });

    await repository.markMigration(migration.markerId, 'migrated');
    expect(await database.get('migrationBackups', migration.markerId)).toMatchObject({
      status: 'migrated',
    });

    const cleanupRepository = new LocalBoardRepository(
      database,
      () => new Date('2026-09-30T00:00:00.000Z'),
    );
    await expect(cleanupRepository.cleanupExpiredGuestMigrations()).resolves.toBe(1);
    expect(await repository.getBoard('local_guest-1')).toBeUndefined();
    expect(await database.get('migrationBackups', migration.markerId)).toBeUndefined();
    expect(await repository.getBoard(migration.board.boardId)).toBeDefined();
  });

  it('本地画板列表按更新时间排序，删除时一并清理关联数据', async () => {
    const { repository, database } = await createRepository();
    await repository.saveDurableChange(emptySnapshot('local_old'));
    await repository.saveDurableChange(emptySnapshot('local_new'));
    const newer = await repository.getBoard('local_new');
    expect(newer).toBeDefined();
    await database.put('boards', { ...newer!, updatedAt: '2026-09-22T00:01:00.000Z' });

    await expect(repository.listLocalBoards()).resolves.toEqual([
      expect.objectContaining({ boardId: 'local_new' }),
      expect.objectContaining({ boardId: 'local_old' }),
    ]);
    await repository.deleteLocalBoard('local_new');
    expect(await repository.getBoard('local_new')).toBeUndefined();
    expect(await repository.getOutbox('local_new')).toEqual([]);
    await expect(repository.deleteLocalBoard('cloud-board')).rejects.toMatchObject({
      code: 'DATABASE_CORRUPTED',
    });
  });

  it('显式清空本地数据时清理所有恢复存储', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot('local_clear'));
    await repository.addMigrationBackup({
      rawData: { legacy: true },
      source: 'v1',
      createdAt: now.toISOString(),
      cleanupAt: '2026-09-29T00:00:00.000Z',
      status: 'pending',
    });

    await repository.clearAllLocalData();

    await expect(repository.exportRawData()).resolves.toMatchObject({
      boards: [],
      assets: [],
      outbox: [],
      preferences: [],
      migrationBackups: [],
      conflictCopies: [],
    });
  });

  it('将最新本地冲突副本另存为全新云画板', async () => {
    const { repository } = await createRepository();
    const source = await repository.saveDurableChange(emptySnapshot('board-conflict'));
    await repository.createConflictCopy(source, 7);

    const copied = await repository.prepareConflictCopyAsNewBoard(
      'board-conflict',
      '66666666-6666-4666-8666-666666666666',
      'user-1',
    );

    expect(copied).toMatchObject({
      boardId: '66666666-6666-4666-8666-666666666666',
      remoteRevision: 0,
      dirty: true,
      snapshot: { boardId: '66666666-6666-4666-8666-666666666666', revision: 0 },
    });
    expect(await repository.getOutbox(copied.boardId)).toEqual([
      expect.objectContaining({ operation: 'snapshot', baseRevision: 0 }),
    ]);
    await expect(repository.getPreparedConflictTarget('board-conflict')).resolves.toBe(
      copied.boardId,
    );
    expect(await repository.getConflictCopies('board-conflict')).toHaveLength(1);
  });

  it('选择远端版本后清理冲突与待同步任务并保存干净快照', async () => {
    const { repository } = await createRepository();
    const source = await repository.saveDurableChange(emptySnapshot('board-conflict'));
    await repository.createConflictCopy(source, 7);
    const remote = { ...emptySnapshot('board-conflict'), revision: 7 };

    await expect(repository.resolveConflictWithRemote(remote)).resolves.toMatchObject({
      boardId: 'board-conflict',
      remoteRevision: 7,
      dirty: false,
    });
    expect(await repository.getConflictCopies('board-conflict')).toEqual([]);
    expect(await repository.getOutbox('board-conflict')).toEqual([]);
  });

  it('远端资产未全部下载校验前不覆盖本地冲突副本', async () => {
    const { repository } = await createRepository();
    const contentHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const blob = new Blob(['hello'], { type: 'image/png' });
    const manifest = {
      fileId: 'file-1',
      objectPath: `user-1/board-conflict/${contentHash}`,
      contentHash,
      mimeType: 'image/png' as const,
      byteSize: blob.size,
      width: 1,
      height: 1,
    };
    await repository.putAsset(manifest, blob);
    const source = await repository.saveDurableChange({
      ...emptySnapshot('board-conflict'),
      assets: [manifest],
    });
    await repository.createConflictCopy(source, 7);

    await expect(
      repository.resolveConflictWithRemote({ ...source.snapshot, revision: 7 }),
    ).rejects.toMatchObject({ code: 'MISSING_ASSET' });

    expect(await repository.getConflictCopies('board-conflict')).toHaveLength(1);
    expect(await repository.getBoard('board-conflict')).toMatchObject({ dirty: true });
  });

  it('本地副本另存成功后可只清理原云画板缓存', async () => {
    const { repository } = await createRepository();
    const source = await repository.saveDurableChange(emptySnapshot('board-conflict'));
    await repository.createConflictCopy(source, 7);
    await repository.prepareConflictCopyAsNewBoard(
      'board-conflict',
      '77777777-7777-4777-8777-777777777777',
      'user-1',
    );

    await repository.clearCloudBoardCacheAfterConflict('board-conflict');

    expect(await repository.getBoard('board-conflict')).toBeUndefined();
    expect(await repository.getConflictCopies('board-conflict')).toEqual([]);
    expect(await repository.getPreparedConflictTarget('board-conflict')).toBeNull();
    expect(await repository.getBoard('77777777-7777-4777-8777-777777777777')).toBeDefined();
    await expect(repository.clearCloudBoardCacheAfterConflict('local_guest')).rejects.toMatchObject(
      { code: 'DATABASE_CORRUPTED' },
    );
  });
});

describe('BoardSyncEngine', () => {
  const remote = (): RemoteBoardGateway => ({
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    saveSnapshot: vi.fn().mockResolvedValue(1),
    deleteBoard: vi.fn().mockResolvedValue(undefined),
  });

  it('同步成功后更新远端 revision 并清理 outbox', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot());
    const gateway = remote();
    const engine = new BoardSyncEngine(repository, gateway, () => true);

    await expect(engine.syncBoard('board-1')).resolves.toEqual({
      boardId: 'board-1',
      state: 'synced',
    });
    expect(gateway.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'board-1', localRevision: 1 }),
      0,
    );
    expect(await repository.getOutbox('board-1')).toEqual([]);
    expect(await repository.getBoard('board-1')).toMatchObject({
      remoteRevision: 1,
      dirty: false,
      snapshot: { revision: 1 },
    });
  });

  it('并发触发时同一画板只有一个同步执行者', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot());
    let release: ((revision: number) => void) | undefined;
    const saveSnapshot = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );
    const engine = new BoardSyncEngine(repository, { ...remote(), saveSnapshot }, () => true);

    const first = engine.syncBoard('board-1');
    const second = engine.syncBoard('board-1');
    expect(first).toBe(second);
    await vi.waitFor(() => expect(saveSnapshot).toHaveBeenCalledOnce());
    release?.(1);
    await expect(first).resolves.toMatchObject({ state: 'synced' });
  });

  it('revision 冲突时保存本地副本并停止自动覆盖', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot());
    const gateway = remote();
    vi.mocked(gateway.saveSnapshot).mockRejectedValue(new RevisionConflictError(7));
    const engine = new BoardSyncEngine(repository, gateway, () => true);

    await expect(engine.syncBoard('board-1')).resolves.toMatchObject({ state: 'conflict' });
    expect(await repository.getConflictCopies('board-1')).toEqual([
      expect.objectContaining({ boardId: 'board-1', remoteRevision: 7, localRevision: 1 }),
    ]);
    expect(await repository.getOutbox('board-1')).toEqual([]);
  });

  it('迁移任务使用与普通快照相同的资产优先同步协议', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot('local_guest'));
    const { board } = await repository.prepareGuestMigration(
      'local_guest',
      '44444444-4444-4444-8444-444444444444',
      'user-1',
    );
    const gateway = remote();
    const engine = new BoardSyncEngine(repository, gateway, () => true);

    await expect(engine.syncBoard(board.boardId)).resolves.toMatchObject({ state: 'synced' });
    expect(gateway.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: board.boardId }),
      0,
    );
    expect(await repository.getOutbox(board.boardId)).toEqual([]);
  });

  it('同步期间产生新修改时保留新任务并推进其 baseRevision', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot());
    const originalOperation = (await repository.getOutbox('board-1'))[0];
    const boardAtSyncStart = await repository.getBoard('board-1');
    expect(originalOperation).toBeDefined();
    expect(boardAtSyncStart).toBeDefined();

    await repository.saveDurableChange({
      ...emptySnapshot(),
      updatedAt: '2026-09-22T00:02:00.000Z',
    });
    await repository.completeSnapshot(originalOperation!, 1);

    expect(await repository.getBoard('board-1')).toMatchObject({
      localRevision: 2,
      remoteRevision: 1,
      dirty: true,
    });
    expect(await repository.getOutbox('board-1')).toEqual([
      expect.objectContaining({ localRevision: 2, baseRevision: 1 }),
    ]);
  });

  it('离线时不调用远端，普通失败按指数退避重试', async () => {
    const { repository } = await createRepository();
    await repository.saveDurableChange(emptySnapshot());
    const gateway = remote();
    const offline = new BoardSyncEngine(repository, gateway, () => false);
    await expect(offline.syncBoard('board-1')).resolves.toMatchObject({ state: 'offline' });
    expect(gateway.saveSnapshot).not.toHaveBeenCalled();

    vi.mocked(gateway.saveSnapshot).mockRejectedValue(new Error('temporary'));
    const online = new BoardSyncEngine(repository, gateway, () => true);
    await expect(online.syncBoard('board-1')).resolves.toMatchObject({
      state: 'retrying',
      retryAt: now.getTime() + 1_000,
    });
    expect(await repository.getOutbox('board-1')).toEqual([
      expect.objectContaining({ attempts: 1, nextAttemptAt: now.getTime() + 1_000 }),
    ]);
  });

  it('本地数据库错误会阻断后续云写入', async () => {
    const { repository } = await createRepository();
    vi.spyOn(repository, 'getOutbox').mockRejectedValue(
      new LocalPersistenceError('DATABASE_CORRUPTED', 'broken'),
    );
    const gateway = remote();
    const engine = new BoardSyncEngine(repository, gateway, () => true);

    await expect(engine.syncBoard('board-1')).resolves.toMatchObject({ state: 'failed-local' });
    expect(engine.areCloudWritesBlocked).toBe(true);
    await expect(engine.syncBoard('board-2')).resolves.toMatchObject({ state: 'failed-local' });
    expect(gateway.saveSnapshot).not.toHaveBeenCalled();
  });
});
