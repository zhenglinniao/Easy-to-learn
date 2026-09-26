import { describe, expect, it, vi } from 'vitest';

import { addStepIllustrationFile, type GeneratedIllustrationAsset } from './illustrationAsset';

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const asset: GeneratedIllustrationAsset = {
  fileId: '00000000-0000-4000-8000-000000000020',
  downloadUrl: 'https://storage.example.test/illustration.jpg?token=opaque',
  mimeType: 'image/jpeg',
  byteSize: bytes.byteLength,
  width: 100,
  height: 100,
};

describe('addStepIllustrationFile', () => {
  it('downloads a validated asset and registers a data URL with Excalidraw', async () => {
    const addFiles = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(bytes.byteLength),
        },
      }),
    );

    await addStepIllustrationFile({ addFiles } as never, asset, undefined, fetcher);

    expect(fetcher).toHaveBeenCalledWith(asset.downloadUrl, undefined);
    expect(addFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        id: asset.fileId,
        mimeType: 'image/jpeg',
        dataURL: expect.stringMatching(/^data:image\/jpeg;base64,/),
      }),
    ]);
  });

  it('rejects unexpected type or byte count before adding the file', async () => {
    const addFiles = vi.fn();
    const wrongType = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
    await expect(
      addStepIllustrationFile({ addFiles } as never, asset, undefined, wrongType),
    ).rejects.toThrow('文件校验失败');

    const wrongSize = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([...bytes, 0]), {
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    await expect(
      addStepIllustrationFile({ addFiles } as never, asset, undefined, wrongSize),
    ).rejects.toThrow('文件校验失败');
    expect(addFiles).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared response before consuming its body', async () => {
    const addFiles = vi.fn();
    const blob = vi.fn(() => Promise.resolve(new Blob([bytes], { type: 'image/jpeg' })));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Length': String(10 * 1024 * 1024 + 1) }),
      blob,
    } as unknown as Response);

    await expect(
      addStepIllustrationFile({ addFiles } as never, asset, undefined, fetcher),
    ).rejects.toThrow('文件校验失败');
    expect(blob).not.toHaveBeenCalled();
    expect(addFiles).not.toHaveBeenCalled();
  });
});
