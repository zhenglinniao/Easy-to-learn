import { afterEach, describe, expect, it, vi } from 'vitest';

import { TutorApiClient } from './client';

const guestQuota = (nextAllowedAt: string) => ({
  dailyLimit: 3 as const,
  remaining: 2,
  nextAllowedAt,
  action: {
    dailyLimit: 3 as const,
    dailyRemaining: 2,
    periodLimit: 15 as const,
    periodRemaining: 14,
    nextAllowedAt,
    dailyResetsAt: '2026-09-23T16:00:00.000Z',
    periodResetsAt: '2026-10-23T00:00:00.000Z',
  },
  image: {
    dailyLimit: 1 as const,
    dailyRemaining: 1,
    periodLimit: 3 as const,
    periodRemaining: 3,
    periodResetsAt: null,
  },
  mode: 'full' as const,
});

describe('TutorApiClient', () => {
  it('分别读取游客和登录用户额度', async () => {
    const quota = guestQuota('2026-09-23T00:05:00.000Z');
    const guestFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: { expiresAt: '2026-10-23T00:00:00.000Z', quota },
      }),
    );
    await expect(new TutorApiClient(async () => null, guestFetcher).quotaStatus()).resolves.toEqual(
      quota,
    );
    expect(guestFetcher).toHaveBeenCalledWith(
      '/api/anonymous/session',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );

    const userQuota = {
      ...quota,
      action: { ...quota.action, periodLimit: 45 as const, periodRemaining: 44 },
      image: {
        ...quota.image,
        dailyLimit: 2 as const,
        dailyRemaining: 2,
        periodLimit: 20 as const,
        periodRemaining: 20,
      },
    };
    const userFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { quota: userQuota } }));
    await expect(new TutorApiClient(async () => 'jwt', userFetcher).quotaStatus()).resolves.toEqual(
      userQuota,
    );
    expect(userFetcher).toHaveBeenCalledWith(
      '/api/ai/quota',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
    expect(new Headers(userFetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer jwt',
    );
  });

  it('默认 fetch 不会因方法 this 绑定触发 Illegal invocation', async () => {
    const request = {
      requestId: 'request-native-fetch',
      schemaVersion: 1 as const,
      boardId: 'local_board-1',
      mode: 'solve' as const,
      text: '2 + 2',
      locale: 'zh-CN' as const,
      source: {
        elementIds: ['element-1'],
        selectionBounds: { x: 0, y: 0, width: 40, height: 20 },
        contentHash: 'native-fetch',
      },
    };
    const response = {
      data: {
        requestId: request.requestId,
        result: {
          schemaVersion: 1,
          mode: 'solve',
          title: '加法',
          steps: [
            {
              id: 'step-1',
              title: '相加',
              blocks: [{ type: 'paragraph', text: '答案是 4。' }],
            },
          ],
          metadata: {
            model: 'test',
            promptVersion: 'v1',
            generatedAt: '2026-09-23T00:00:00.000Z',
          },
        },
        quota: guestQuota('2026-09-23T00:05:00.000Z'),
      },
    };
    const nativeLikeFetch = vi.fn(function (this: typeof globalThis, input: RequestInfo | URL) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      const url = String(input);
      if (url.endsWith('/api/anonymous/session')) return Promise.resolve(new Response('{}'));
      return Promise.resolve(new Response(JSON.stringify(response)));
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', nativeLikeFetch);

    await expect(new TutorApiClient(async () => null).execute(request)).resolves.toMatchObject({
      requestId: request.requestId,
    });
    vi.unstubAllGlobals();
  });
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
          quota: guestQuota('2026-09-22T00:05:00.000Z'),
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

  it('提交结构化 AI 反馈并携带登录凭据', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const input = {
      requestId: '00000000-0000-4000-8000-000000000010',
      rating: -1 as const,
      category: 'incorrect_answer' as const,
    };

    await expect(
      new TutorApiClient(async () => 'jwt', fetcher).submitFeedback(input),
    ).resolves.toBeUndefined();

    const options = fetcher.mock.calls[0]?.[1];
    expect(fetcher).toHaveBeenCalledWith(
      '/api/ai/feedback',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    );
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer jwt');
  });

  it('为游客反馈建立会话并显示服务端错误', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'FORBIDDEN', message: '反馈窗口已结束' }), {
          status: 403,
        }),
      );

    await expect(
      new TutorApiClient(async () => null, fetcher).submitFeedback({
        requestId: '00000000-0000-4000-8000-000000000010',
        rating: 1,
      }),
    ).rejects.toThrow('反馈窗口已结束');
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/anonymous/session',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });
});
