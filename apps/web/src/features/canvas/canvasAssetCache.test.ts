import type { StoredAsset } from '@easy-to-learn/persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasAssetCache } from './canvasAssetCache';

const file = (data = 'first') => ({
  id: 'file-1',
  dataURL: `data:image/png;base64,${btoa(data)}`,
  mimeType: 'image/png',
});

afterEach(() => vi.unstubAllGlobals());

describe('CanvasAssetCache', () => {
  it('reuses decoded metadata until the same file id changes content', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 320, height: 180, close }),
    );
    const nativeFetch = globalThis.fetch;
    const fetcher = vi.fn<typeof fetch>((...args) => nativeFetch(...args));
    vi.stubGlobal('fetch', fetcher);
    const writer = { putAsset: vi.fn().mockResolvedValue(undefined) };
    const cache = new CanvasAssetCache();

    const first = await cache.prepare(writer, 'board-1', 'owner-1', [file()], new Map());
    const second = await cache.prepare(writer, 'board-1', 'owner-1', [file()], new Map());

    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(writer.putAsset).toHaveBeenCalledTimes(1);

    await cache.prepare(writer, 'board-1', 'owner-1', [file('changed')], new Map());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(writer.putAsset).toHaveBeenCalledTimes(2);
  });

  it('can seed metadata restored from IndexedDB without decoding it again', async () => {
    const cache = new CanvasAssetCache();
    const restoredFile = file();
    const stored = {
      boardId: 'board-1',
      fileId: restoredFile.id,
      objectPath: `owner-1/board-1/${'a'.repeat(64)}`,
      contentHash: 'a'.repeat(64),
      mimeType: 'image/png',
      byteSize: 5,
      width: 320,
      height: 180,
      uploadState: 'uploaded',
      blob: new Blob(['first'], { type: 'image/png' }),
    } satisfies StoredAsset;
    cache.seed(restoredFile, stored);
    expect(cache.canReuse([restoredFile])).toBe(true);
    expect(cache.canReuse([file('different')])).toBe(false);
    const writer = { putAsset: vi.fn() };

    await expect(
      cache.prepare(writer, 'board-1', 'owner-1', [restoredFile], new Map()),
    ).resolves.toEqual([
      expect.objectContaining({ fileId: 'file-1', contentHash: 'a'.repeat(64) }),
    ]);
    expect(writer.putAsset).not.toHaveBeenCalled();
  });

  it('rejects unsupported formats before writing an invalid snapshot', async () => {
    const cache = new CanvasAssetCache();
    await expect(
      cache.prepare(
        { putAsset: vi.fn() },
        'board-1',
        'owner-1',
        [{ id: 'svg-1', dataURL: 'data:image/svg+xml,<svg/>', mimeType: 'image/svg+xml' }],
        new Map(),
      ),
    ).rejects.toThrow('PNG、JPEG 或 WebP');
  });
});
