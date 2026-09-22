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

  it('登录用户携带 Bearer 并校验 Tutor DSL 响应', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: {
          requestId: 'request-1',
          result: {
            schemaVersion: 1,
            mode: 'solve',
            title: '解题',
            steps: [
              {
                id: 'step-1',
                title: '观察',
                blocks: [{ type: 'paragraph', text: '先观察等式两边。' }],
              },
            ],
            metadata: {
              model: 'test-model',
              promptVersion: 'v1',
              generatedAt: '2026-09-22T00:00:00.000Z',
            },
          },
          quota: {
            dailyLimit: 3,
            remaining: 2,
            nextAllowedAt: '2026-09-22T00:05:00.000Z',
          },
        },
      }),
    );
    const request = {
      requestId: 'request-1',
      schemaVersion: 1 as const,
      boardId: '00000000-0000-4000-8000-000000000001',
      mode: 'solve' as const,
      text: '2x + 3 = 11',
      locale: 'zh-CN' as const,
      source: {
        elementIds: ['element-1'],
        selectionBounds: { x: 0, y: 0, width: 100, height: 40 },
        contentHash: 'hash',
      },
    };

    await expect(
      new TutorApiClient(async () => 'jwt', fetcher).execute(request),
    ).resolves.toMatchObject({
      requestId: 'request-1',
      result: { mode: 'solve' },
    });
    const options = fetcher.mock.calls[0]?.[1];
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer jwt');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('优先显示结构化 API 错误并拒绝非法模型响应', async () => {
    const request = {
      requestId: 'request-1',
      schemaVersion: 1 as const,
      boardId: 'local_board-1',
      mode: 'solve' as const,
      text: '题目',
      locale: 'zh-CN' as const,
      source: {
        elementIds: ['element-1'],
        selectionBounds: { x: 0, y: 0, width: 20, height: 20 },
        contentHash: 'hash',
      },
    };
    const limited = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 'RATE_LIMITED', message: '请稍后再试' }), {
        status: 429,
      }),
    );
    await expect(new TutorApiClient(async () => 'jwt', limited).execute(request)).rejects.toThrow(
      '请稍后再试',
    );

    const invalid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { html: '<b>x</b>' } }));
    await expect(new TutorApiClient(async () => 'jwt', invalid).execute(request)).rejects.toThrow();
  });
});
