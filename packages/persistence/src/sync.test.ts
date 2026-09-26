import { describe, expect, it, vi } from 'vitest';

import type { StoredAsset } from './schema';
import { uploadAssetsWithConcurrency } from './sync';

const asset = (index: number): StoredAsset => ({
  boardId: 'board-1',
  fileId: `file-${index}`,
  blob: new Blob([String(index)], { type: 'image/png' }),
  contentHash: String(index).padStart(64, '0'),
  mimeType: 'image/png',
  byteSize: 1,
  width: 1,
  height: 1,
  uploadState: 'local',
  objectPath: `owner/board-1/${String(index).padStart(64, '0')}`,
});

describe('uploadAssetsWithConcurrency', () => {
  it('以固定上限并发上传全部资产', async () => {
    let active = 0;
    let peak = 0;
    const completed: string[] = [];
    const upload = vi.fn(async (item: StoredAsset) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed.push(item.fileId);
      active -= 1;
    });

    await uploadAssetsWithConcurrency(
      Array.from({ length: 8 }, (_, index) => asset(index)),
      upload,
    );

    expect(upload).toHaveBeenCalledTimes(8);
    expect(peak).toBe(3);
    expect(completed).toHaveLength(8);
  });

  it('某个上传失败后等待已开始任务收尾并停止派发新任务', async () => {
    let active = 0;
    const upload = vi.fn(async (item: StoredAsset) => {
      active += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (item.fileId === 'file-1') throw new Error('upload failed');
    });

    await expect(
      uploadAssetsWithConcurrency(
        Array.from({ length: 10 }, (_, index) => asset(index)),
        upload,
      ),
    ).rejects.toThrow('upload failed');
    expect(active).toBe(0);
    expect(upload.mock.calls.length).toBeLessThan(10);
  });

  it('拒绝无效并发参数', async () => {
    await expect(uploadAssetsWithConcurrency([asset(0)], vi.fn(), 0)).rejects.toThrow(RangeError);
  });
});
