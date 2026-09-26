import { parsePersistedCanvas, type PersistedCanvasV2 } from '@easy-to-learn/domain';

import { LocalPersistenceError } from './errors';
import type { RawLocalDataExport, StoredAsset } from './schema';

const MAX_EXPORT_BYTES = 100 * 1024 * 1024;

export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
};

export const serializeStoredAssets = async (
  assets: readonly StoredAsset[],
): Promise<RawLocalDataExport['assets']> => {
  const totalBytes = assets.reduce(
    (sum, asset) => sum + Math.max(asset.byteSize, asset.blob.size),
    0,
  );
  if (totalBytes > MAX_EXPORT_BYTES)
    throw new LocalPersistenceError(
      'QUOTA_EXCEEDED',
      '本地完整备份不能超过 100 MiB，请改为逐个导出画板。',
    );

  const serialized: RawLocalDataExport['assets'] = [];
  for (const { blob, ...asset } of assets) {
    serialized.push({ ...asset, base64: await blobToBase64(blob) });
  }
  return serialized;
};

const verifiedAssets = (
  canvas: PersistedCanvasV2,
  assets: readonly StoredAsset[],
): StoredAsset[] => {
  const byIdentity = new Map(
    assets.map(
      (asset) => [`${asset.boardId}\0${asset.fileId}\0${asset.contentHash}`, asset] as const,
    ),
  );
  return canvas.assets.map((manifest) => {
    const asset = byIdentity.get(`${canvas.boardId}\0${manifest.fileId}\0${manifest.contentHash}`);
    if (!asset || asset.byteSize !== manifest.byteSize || asset.mimeType !== manifest.mimeType)
      throw new LocalPersistenceError('MISSING_ASSET', `导出缺少完整资产：${manifest.fileId}`);
    return asset;
  });
};

const ensureExportSize = (assets: readonly StoredAsset[]): void => {
  if (assets.reduce((sum, asset) => sum + asset.byteSize, 0) > MAX_EXPORT_BYTES)
    throw new LocalPersistenceError('QUOTA_EXCEEDED', '画板导出不能超过 100 MiB');
};

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
  ensureExportSize(selected);
  const embeddedAssets: EasyToLearnExportV1['embeddedAssets'] = [];
  for (const asset of selected) {
    embeddedAssets.push({
      fileId: asset.fileId,
      mimeType: asset.mimeType,
      contentHash: asset.contentHash,
      base64: await blobToBase64(asset.blob),
    });
  }
  return {
    format: 'easy-to-learn',
    exportVersion: 1,
    exportedAt: now.toISOString(),
    canvas,
    embeddedAssets,
  };
};

export const createExcalidrawExport = async (
  snapshotInput: PersistedCanvasV2,
  assets: readonly StoredAsset[],
) => {
  const canvas = parsePersistedCanvas(snapshotInput);
  const selected = verifiedAssets(canvas, assets);
  ensureExportSize(selected);
  const files: Record<string, object> = {};
  for (const asset of selected) {
    const timestamp = Date.now();
    files[asset.fileId] = {
      id: asset.fileId,
      mimeType: asset.mimeType,
      dataURL: `data:${asset.mimeType};base64,${await blobToBase64(asset.blob)}`,
      created: timestamp,
      lastRetrieved: timestamp,
    };
  }
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
