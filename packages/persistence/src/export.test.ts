import type { PersistedCanvasV2 } from '@easy-to-learn/domain';
import { describe, expect, it } from 'vitest';

import { createCompleteExport, createExcalidrawExport } from './export';
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
});
