import { afterEach, describe, expect, it, vi } from 'vitest';

import { TutorApiClient } from './client';

describe('TutorApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('为游客获取会话并通过一次性票据上传大图', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 800, height: 600, close }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            uploadUrl: 'https://storage.example.test/upload?token=opaque',
            uploadPath: 'actor/request/hash',
            expiresAt: '2026-09-22T12:10:00.000Z',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const blob = new Blob(['large-image'], { type: 'image/png' });

    const result = await new TutorApiClient(async () => null, fetcher).uploadImage(
      'request-1',
      blob,
    );

    expect(result).toEqual({ mimeType: 'image/png', uploadPath: 'actor/request/hash' });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/anonymous/session',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/ai/upload-ticket',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'https://storage.example.test/upload?token=opaque',
      expect.objectContaining({ method: 'PUT', body: blob }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('拒绝不受支持的临时图片类型', async () => {
    const client = new TutorApiClient(async () => null, vi.fn<typeof fetch>());
    await expect(
      client.uploadImage('request-1', new Blob(['x'], { type: 'image/webp' })),
    ).rejects.toThrow('仅支持 PNG 或 JPEG');
  });
});
