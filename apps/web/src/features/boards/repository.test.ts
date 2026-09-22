import type { PersistedCanvasV2 } from '@easy-to-learn/domain';
import {
  RevisionConflictError,
  type StoredAsset,
  type StoredBoard,
} from '@easy-to-learn/persistence';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { RemoteBoardRepository, SupabaseBoardGateway } from './repository';

const snapshot: PersistedCanvasV2 = {
  schemaVersion: 2,
  boardId: '00000000-0000-4000-8000-000000000001',
  revision: 2,
  excalidraw: {
    elements: [],
    appState: {
      viewBackgroundColor: '#fff',
      gridSize: null,
      gridStep: 20,
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
    },
  },
  assets: [],
  tutorBoards: [],
  updatedAt: '2026-09-22T00:00:00.000Z',
};

const storedBoard: StoredBoard = {
  boardId: snapshot.boardId,
  snapshot,
  localRevision: 3,
  remoteRevision: 2,
  dirty: true,
  updatedAt: snapshot.updatedAt,
};

describe('RemoteBoardRepository', () => {
  it('限制分页大小并映射画板摘要', async () => {
    const range = vi.fn().mockResolvedValue({
      data: [
        {
          id: snapshot.boardId,
          title: '数学草稿',
          revision: '2',
          created_at: snapshot.updatedAt,
          updated_at: snapshot.updatedAt,
        },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ range });
    const select = vi.fn().mockReturnValue({ order });
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient;

    const result = await new RemoteBoardRepository(client).list(5, 1_000);

    expect(range).toHaveBeenCalledWith(5, 104);
    expect(result).toEqual([
      expect.objectContaining({ id: snapshot.boardId, title: '数学草稿', revision: 2 }),
    ]);
  });

  it('拒绝服务端返回的非法快照', async () => {
    const single = vi.fn().mockResolvedValue({ data: { snapshot_json: { schemaVersion: 1 } } });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient;

    await expect(new RemoteBoardRepository(client).read(snapshot.boardId)).rejects.toThrow();
  });
});

describe('SupabaseBoardGateway', () => {
  it('先上传私有资产并用 expected revision 保存快照', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const single = vi.fn().mockResolvedValue({ data: { revision: 3 }, error: null });
    const rpc = vi.fn().mockReturnValue({ single });
    const client = {
      storage: { from: vi.fn().mockReturnValue({ upload }) },
      rpc,
    } as unknown as SupabaseClient;
    const gateway = new SupabaseBoardGateway(client, 'editor-1');
    const blob = new Blob(['image'], { type: 'image/png' });
    const asset: StoredAsset = {
      boardId: snapshot.boardId,
      fileId: 'file-1',
      blob,
      contentHash: 'a'.repeat(64),
      mimeType: 'image/png',
      byteSize: blob.size,
      width: 10,
      height: 10,
      uploadState: 'local',
      objectPath: `user-1/${snapshot.boardId}/${'a'.repeat(64)}`,
    };

    await gateway.uploadAsset(asset);
    await expect(gateway.saveSnapshot(storedBoard, 2)).resolves.toBe(3);

    expect(upload).toHaveBeenCalledWith(asset.objectPath, blob, {
      contentType: 'image/png',
      upsert: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      'save_board',
      expect.objectContaining({ p_expected_revision: 2, p_editor_id: 'editor-1' }),
    );
  });

  it('把 revision 冲突转换为带远端版本的领域错误', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'REVISION_CONFLICT' },
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { revision: 7 } });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const client = {
      rpc: vi.fn().mockReturnValue({ single }),
      from: vi.fn().mockReturnValue({ select }),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseBoardGateway(client, 'editor-1').saveSnapshot(storedBoard, 2),
    ).rejects.toEqual(new RevisionConflictError(7));
  });
});
