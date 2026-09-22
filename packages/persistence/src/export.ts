import { parsePersistedCanvas, type PersistedCanvasV2 } from '@easy-to-learn/domain';

import { LocalPersistenceError } from './errors';
import type { StoredAsset } from './schema';

const MAX_EXPORT_BYTES = 100 * 1024 * 1024;

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
};

const verifiedAssets = (canvas: PersistedCanvasV2, assets: readonly StoredAsset[]): StoredAsset[] =>
  canvas.assets.map((manifest) => {
    const asset = assets.find(
      (candidate) =>
        candidate.boardId === canvas.boardId &&
        candidate.fileId === manifest.fileId &&
        candidate.contentHash === manifest.contentHash,
    );
    if (!asset || asset.byteSize !== manifest.byteSize || asset.mimeType !== manifest.mimeType)
      throw new LocalPersistenceError('MISSING_ASSET', `导出缺少完整资产：${manifest.fileId}`);
    return asset;
  });

export interface EasyToLearnExportV1 {
  format: 'easy-to-learn';
  exportVersion: 1;
  exportedAt: string;
  canvas: PersistedCanvasV2;
  embeddedAssets: Array<{
    fileId: string;
    mimeType: StoredAsset['mimeType'];
    contentHash: string;
    base64: string;
  }>;
}

export const createCompleteExport = async (
  snapshotInput: PersistedCanvasV2,
  assets: readonly StoredAsset[],
  now = new Date(),
): Promise<EasyToLearnExportV1> => {
  const canvas = parsePersistedCanvas(snapshotInput);
  const selected = verifiedAssets(canvas, assets);
  if (selected.reduce((sum, asset) => sum + asset.byteSize, 0) > MAX_EXPORT_BYTES)
    throw new LocalPersistenceError('QUOTA_EXCEEDED', '完整导出不能超过 100 MiB');
  return {
    format: 'easy-to-learn',
    exportVersion: 1,
    exportedAt: now.toISOString(),
    canvas,
    embeddedAssets: await Promise.all(
      selected.map(async (asset) => ({
        fileId: asset.fileId,
        mimeType: asset.mimeType,
        contentHash: asset.contentHash,
        base64: await blobToBase64(asset.blob),
      })),
    ),
  };
};

export const createExcalidrawExport = async (
  snapshotInput: PersistedCanvasV2,
  assets: readonly StoredAsset[],
) => {
  const canvas = parsePersistedCanvas(snapshotInput);
  const selected = verifiedAssets(canvas, assets);
  const files = Object.fromEntries(
    await Promise.all(
      selected.map(
        async (asset) =>
          [
            asset.fileId,
            {
              id: asset.fileId,
              mimeType: asset.mimeType,
              dataURL: `data:${asset.mimeType};base64,${await blobToBase64(asset.blob)}`,
              created: Date.now(),
              lastRetrieved: Date.now(),
            },
          ] as const,
      ),
    ),
  );
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://easy-to-learn.app',
    elements: canvas.excalidraw.elements,
    appState: canvas.excalidraw.appState,
    files,
  };
};

export const exportAsJsonBlob = (value: unknown): Blob =>
  new Blob([JSON.stringify(value)], { type: 'application/json' });
