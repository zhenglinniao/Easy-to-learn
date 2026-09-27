import {
  MAX_ASSET_BYTES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  type AssetManifestItem,
} from '@easy-to-learn/domain';
import type { StoredAsset } from '@easy-to-learn/persistence';

export interface CanvasAssetFile {
  id: string;
  dataURL: string;
  mimeType: string;
}

export interface CanvasAssetWriter {
  putAsset(manifest: AssetManifestItem, blob: Blob): Promise<unknown>;
}

interface CacheEntry {
  dataURL: string;
  manifest: AssetManifestItem;
}

const supportedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

const sha256 = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** Caches immutable Excalidraw binary metadata so ordinary text edits do not decode every image. */
export class CanvasAssetCache {
  private readonly entries = new Map<string, CacheEntry>();

  canReuse(files: readonly CanvasAssetFile[]): boolean {
    return files.every((file) => this.entries.get(file.id)?.dataURL === file.dataURL);
  }

  seed(file: CanvasAssetFile, asset: StoredAsset): void {
    this.entries.set(file.id, {
      dataURL: file.dataURL,
      manifest: {
        fileId: asset.fileId,
        objectPath: asset.objectPath,
        contentHash: asset.contentHash,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
      },
    });
  }

  async prepare(
    writer: CanvasAssetWriter,
    boardId: string,
    ownerId: string,
    files: readonly CanvasAssetFile[],
    existingAssets: ReadonlyMap<string, StoredAsset>,
  ): Promise<AssetManifestItem[]> {
    const manifests: AssetManifestItem[] = [];
    const liveIds = new Set<string>();
    for (const file of files) {
      liveIds.add(file.id);
      const cached = this.entries.get(file.id);
      if (cached?.dataURL === file.dataURL) {
        manifests.push(cached.manifest);
        continue;
      }
      if (!supportedMimeTypes.has(file.mimeType)) {
        throw new Error(
          `暂不支持保存 ${file.mimeType || '未知格式'} 图片，请先转换为 PNG、JPEG 或 WebP。`,
        );
      }
      if (!file.dataURL.startsWith(`data:${file.mimeType};base64,`)) {
        throw new Error('图片来源格式不安全，已停止保存。');
      }
      const blob = await fetch(file.dataURL).then((response) => response.blob());
      if (blob.type !== file.mimeType) throw new Error('图片内容与声明格式不一致，已停止保存。');
      if (blob.size === 0 || blob.size > MAX_ASSET_BYTES) {
        throw new Error('图片文件大小不符合要求，已停止保存。');
      }
      const contentHash = await sha256(blob);
      const bitmap = await createImageBitmap(blob);
      let manifest: AssetManifestItem;
      try {
        if (
          bitmap.width <= 0 ||
          bitmap.height <= 0 ||
          bitmap.width > MAX_IMAGE_EDGE ||
          bitmap.height > MAX_IMAGE_EDGE ||
          bitmap.width * bitmap.height > MAX_IMAGE_PIXELS
        ) {
          throw new Error('图片尺寸不符合要求，已停止保存。');
        }
        manifest = {
          fileId: file.id,
          objectPath: `${ownerId}/${boardId}/${contentHash}`,
          contentHash,
          mimeType: file.mimeType as AssetManifestItem['mimeType'],
          byteSize: blob.size,
          width: bitmap.width,
          height: bitmap.height,
        };
      } finally {
        bitmap.close();
      }
      const existing = existingAssets.get(file.id);
      if (
        !existing ||
        existing.contentHash !== contentHash ||
        existing.objectPath !== manifest.objectPath
      ) {
        await writer.putAsset(manifest, blob);
      }
      this.entries.set(file.id, { dataURL: file.dataURL, manifest });
      manifests.push(manifest);
    }
    for (const id of this.entries.keys()) {
      if (!liveIds.has(id)) this.entries.delete(id);
    }
    return manifests;
  }
}
