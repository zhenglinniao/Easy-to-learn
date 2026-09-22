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
