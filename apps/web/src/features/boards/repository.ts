import { parsePersistedCanvas, type PersistedCanvasV2 } from '@easy-to-learn/domain';
import {
  RevisionConflictError,
  type RemoteBoardGateway,
  type StoredAsset,
  type StoredBoard,
} from '@easy-to-learn/persistence';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BoardSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export class RemoteBoardRepository {
  constructor(private readonly client: SupabaseClient) {}
  async list(offset = 0, limit = 30): Promise<BoardSummary[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const { data, error } = await this.client
      .from('boards')
      .select('id,title,revision,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .range(offset, offset + safeLimit - 1);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      revision: Number(row.revision),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  async create(title = '未命名画板'): Promise<PersistedCanvasV2> {
    const { data, error } = await this.client.rpc('create_board', { p_title: title }).single();
    if (error) throw error;
    return parsePersistedCanvas((data as { snapshot: unknown }).snapshot);
  }
  async read(boardId: string): Promise<PersistedCanvasV2> {
    const { data, error } = await this.client
      .from('boards')
      .select('snapshot_json')
      .eq('id', boardId)
      .single();
    if (error) throw error;
    return parsePersistedCanvas(data.snapshot_json);
  }
  async downloadAsset(objectPath: string): Promise<Blob> {
    const { data, error } = await this.client.storage.from('board-assets').download(objectPath);
    if (error || !data) throw error ?? new Error('画板图片下载失败');
    return data;
  }
  async rename(boardId: string, title: string): Promise<void> {
    const { error } = await this.client.rpc('rename_board', {
      p_board_id: boardId,
      p_title: title.trim(),
    });
    if (error) throw error;
  }
  async delete(boardId: string): Promise<void> {
    const { error } = await this.client.rpc('delete_board', { p_board_id: boardId });
    if (error) throw error;
  }
}

const isRevisionConflict = (error: { message?: string } | null): boolean =>
  error?.message?.includes('REVISION_CONFLICT') ?? false;

export class SupabaseBoardGateway implements RemoteBoardGateway {
  constructor(
    private readonly client: SupabaseClient,
    private readonly editorId: string,
  ) {}

  async uploadAsset(asset: StoredAsset): Promise<void> {
    const { error } = await this.client.storage
      .from('board-assets')
      .upload(asset.objectPath, asset.blob, {
        contentType: asset.mimeType,
        upsert: true,
      });
    if (error) throw error;
  }

  async saveSnapshot(board: StoredBoard, expectedRevision: number): Promise<number> {
    const { data, error } = await this.client
      .rpc('save_board', {
        p_board_id: board.boardId,
        p_expected_revision: expectedRevision,
        p_snapshot: board.snapshot,
        p_asset_manifest: board.snapshot.assets,
        p_editor_id: this.editorId,
      })
      .single();
    if (error) {
      if (isRevisionConflict(error)) {
        const { data: remote } = await this.client
          .from('boards')
          .select('revision')
          .eq('id', board.boardId)
          .maybeSingle();
        throw new RevisionConflictError(Number(remote?.revision ?? expectedRevision + 1));
      }
      throw error;
    }
    return Number((data as { revision: number }).revision);
  }

  async deleteBoard(boardId: string): Promise<void> {
    await new RemoteBoardRepository(this.client).delete(boardId);
  }
}
