import type { PersistedCanvasV2 } from '@easy-to-learn/domain';
import { describe, expect, it } from 'vitest';

import { createCompleteExport, createExcalidrawExport, serializeStoredAssets } from './export';
import type { StoredAsset } from './schema';

const bytes = new TextEncoder().encode('asset');
const hash = 'd59386e0ae4350b45c6604d4319775af639c9fd0ee20d25f5012e2e664706540';
const snapshot: PersistedCanvasV2 = {
  schemaVersion: 2,
  boardId: 'local_test',
  revision: 0,
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
  assets: [
    {
      fileId: 'f1',
      objectPath: `owner/local_test/${hash}`,
      contentHash: hash,
      mimeType: 'image/png',
      byteSize: bytes.byteLength,
      width: 1,
      height: 1,
    },
  ],
  tutorBoards: [],
  updatedAt: '2026-09-22T00:00:00.000Z',
};
const asset: StoredAsset = {
  boardId: 'local_test',
  fileId: 'f1',
  blob: new Blob([bytes], { type: 'image/png' }),
  contentHash: hash,
  mimeType: 'image/png',
  byteSize: bytes.byteLength,
  width: 1,
  height: 1,
  uploadState: 'local',
  objectPath: `owner/local_test/${hash}`,
};

describe('画板导出', () => {
  it('完整导出只在导出对象中嵌入 Base64', async () => {
    const result = await createCompleteExport(
      snapshot,
      [asset],
      new Date('2026-09-22T00:00:00.000Z'),
    );
    expect(result).toMatchObject({
      format: 'easy-to-learn',
      exportVersion: 1,
      embeddedAssets: [{ fileId: 'f1', base64: 'YXNzZXQ=' }],
    });
    expect(JSON.stringify(result.canvas)).not.toContain('YXNzZXQ=');
  });
  it('原始恢复备份把 Blob 转为可写入 JSON 的 Base64', async () => {
    const serialized = await serializeStoredAssets([asset]);

    expect(serialized).toEqual([expect.objectContaining({ fileId: 'f1', base64: 'YXNzZXQ=' })]);
    expect(serialized[0]).not.toHaveProperty('blob');
  });
  it('阻止在内存中构建超大恢复备份', async () => {
    await expect(
      serializeStoredAssets([{ ...asset, byteSize: 100 * 1024 * 1024 + 1 }]),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
  it('生成兼容 Excalidraw 的逃生格式并拒绝缺失资产', async () => {
    const result = await createExcalidrawExport(snapshot, [asset]);
    expect(result).toMatchObject({
      type: 'excalidraw',
      version: 2,
      files: { f1: { dataURL: 'data:image/png;base64,YXNzZXQ=' } },
    });
    await expect(createCompleteExport(snapshot, [])).rejects.toMatchObject({
      code: 'MISSING_ASSET',
    });
  });

  it('按顺序编码资产，避免大画板并发复制全部二进制', async () => {
    let active = 0;
    let peak = 0;
    class MeasuredBlob extends Blob {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const result = await super.arrayBuffer();
        active -= 1;
        return result;
      }
    }
    const manifests = ['a', 'b'].map((seed, index) => ({
      ...snapshot.assets[0]!,
      fileId: `file-${index}`,
      contentHash: seed.repeat(64),
      objectPath: `owner/local_test/${seed.repeat(64)}`,
    }));
    const measuredAssets = manifests.map((manifest) => ({
      ...asset,
      fileId: manifest.fileId,
      contentHash: manifest.contentHash,
      objectPath: manifest.objectPath,
      blob: new MeasuredBlob([bytes], { type: 'image/png' }),
    }));

    await createCompleteExport({ ...snapshot, assets: manifests }, measuredAssets);
    expect(peak).toBe(1);
  });
});
