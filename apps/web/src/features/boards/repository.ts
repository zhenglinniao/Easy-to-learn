import { parsePersistedCanvas, type PersistedCanvasV2 } from '@easy-to-learn/domain';
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
