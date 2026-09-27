import { afterEach, describe, expect, it, vi } from 'vitest';

import { TutorApiClient, TutorApiError, tutorErrorMessage } from './client';

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
      dailyLimit: 10 as const,
      remaining: 9,
      action: {
        ...quota.action,
        dailyLimit: 10 as const,
        dailyRemaining: 9,
        periodLimit: 45 as const,
        periodRemaining: 44,
      },
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

  it('在上传前拒绝超大图片和不安全的签名 URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            uploadUrl: 'http://storage.example.test/upload',
            uploadPath: 'actor/request/hash',
            expiresAt: '2026-09-22T12:10:00.000Z',
          },
        }),
      );
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 800, height: 600, close }),
    );
    const client = new TutorApiClient(async () => null, fetcher);
    const oversized = new Blob(['x'], { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });

    await expect(client.uploadImage('request-1', oversized)).rejects.toThrow('图片大小不符合要求');
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      client.uploadImage('request-2', new Blob(['valid-size'], { type: 'image/png' })),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
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

  it('响应传输中断时使用同一 requestId 自动重试且不暴露 Failed to fetch', async () => {
    const request = {
      requestId: 'request-network-retry',
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
    const success = Response.json({
      data: {
        requestId: request.requestId,
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
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(success);

    await expect(
      new TutorApiClient(async () => 'jwt', fetcher).execute(request),
    ).resolves.toMatchObject({ requestId: request.requestId });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
    expect(fetcher.mock.calls[1]?.[1]?.body).toContain(request.requestId);

    const alwaysFails = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      new TutorApiClient(async () => 'jwt', alwaysFails).execute(request),
    ).rejects.toThrow('AI 响应连接中断，请检查网络后重试。');
    expect(alwaysFails).toHaveBeenCalledTimes(2);
  });

  it('请求独立生图链路并校验生成资产', async () => {
    const quota = guestQuota('2026-09-23T00:05:00.000Z');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: {
          status: 'generated',
          asset: {
            fileId: '00000000-0000-4000-8000-000000000020',
            downloadUrl: 'https://storage.example.test/ai-temp/image.jpg?token=opaque',
            mimeType: 'image/jpeg',
            byteSize: 1024,
            width: 1024,
            height: 1024,
          },
          placement: {
            stepId: 'step-1',
            stepTitle: '按层扩散',
            altText: 'BFS 第一步教学插画',
            caption: '这张图只对应按层扩散。',
          },
          quota,
        },
      }),
    );
    const input = {
      requestId: '00000000-0000-4000-8000-000000000010',
      boardId: '00000000-0000-4000-8000-000000000001',
    };

    await expect(
      new TutorApiClient(async () => 'jwt', fetcher).generateIllustration(input),
    ).resolves.toMatchObject({ status: 'generated', asset: { mimeType: 'image/jpeg' } });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/ai/illustration',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    );
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer jwt',
    );
  });

  it('插画响应传输中断时使用同一 requestId 自动重试', async () => {
    const input = {
      requestId: '00000000-0000-4000-8000-000000000010',
      boardId: '00000000-0000-4000-8000-000000000001',
    };
    const success = Response.json({
      data: {
        status: 'not_applicable',
        quota: guestQuota('2026-09-23T00:05:00.000Z'),
      },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(success);

    await expect(
      new TutorApiClient(async () => 'jwt', fetcher).generateIllustration(input),
    ).resolves.toMatchObject({ status: 'not_applicable' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
    expect(fetcher.mock.calls[1]?.[1]?.body).toContain(input.requestId);
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
      new Response(
        JSON.stringify({
          requestId: 'request-limit-1',
          code: 'RATE_LIMITED',
          message: '请稍后再试',
          retryable: true,
        }),
        { status: 429 },
      ),
    );
    const rejection = new TutorApiClient(async () => 'jwt', limited).execute(request);
    await expect(rejection).rejects.toMatchObject({
      name: 'TutorApiError',
      message: '请稍后再试',
      status: 429,
      code: 'RATE_LIMITED',
      requestId: 'request-limit-1',
      retryable: true,
    });

    const invalid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { html: '<b>x</b>' } }));
    await expect(new TutorApiClient(async () => 'jwt', invalid).execute(request)).rejects.toThrow();
  });

  it('兼容非 JSON 错误并为结构化错误提供可追踪提示', async () => {
    const response = new Response('<html>gateway error</html>', {
      status: 502,
      headers: { 'X-Request-Id': 'gateway-request-1' },
    });
    const client = new TutorApiClient(
      async () => 'jwt',
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
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

    let error: unknown;
    try {
      await client.execute(request);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TutorApiError);
    expect(error).toMatchObject({
      status: 502,
      code: null,
      requestId: 'gateway-request-1',
      retryable: true,
    });
    expect(tutorErrorMessage(error, '请求失败')).toContain('gateway-request-1');
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
