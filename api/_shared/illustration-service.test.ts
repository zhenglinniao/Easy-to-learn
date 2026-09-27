import type { TutorResultV1 } from '@easy-to-learn/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryAiStateStore } from './ai-state.js';
import {
  buildIllustrationPrompt,
  IllustrationService,
  SenseNovaImageGenerator,
  shouldGenerateIllustration,
  validateStoredIllustration,
  type GeneratedImage,
  type IllustrationArtifactRepository,
} from './illustration-service.js';

const now = new Date('2026-09-26T08:00:00.000Z');
const requestId = '00000000-0000-4000-8000-000000000010';
const boardId = '00000000-0000-4000-8000-000000000001';
const actor = { kind: 'user' as const, id: 'user-1' };
const result: TutorResultV1 = {
  schemaVersion: 1,
  mode: 'solve',
  title: '汉堡的结构',
  steps: [
    { id: 'step-1', title: '观察各层', blocks: [{ type: 'paragraph', text: '从上往下观察。' }] },
    { id: 'step-2', title: '理解组合', blocks: [{ type: 'paragraph', text: '各层组成整体。' }] },
  ],
  contentProfile: {
    contentKind: 'food_dish',
    learningGoal: 'recipe',
    goalSource: 'inferred',
    confidence: 'high',
  },
  metadata: { model: 'test', promptVersion: 'v5', generatedAt: now.toISOString() },
};

const prepareState = async () => {
  const state = new MemoryAiStateStore();
  await state.cache(
    'user:user-1',
    requestId,
    { requestId, result, quota: await state.status('user:user-1', now) },
    now,
  );
  return state;
};

const artifact = {
  fileId: '00000000-0000-4000-8000-000000000020',
  downloadUrl: 'https://storage.example.test/image.jpg?token=opaque',
  mimeType: 'image/jpeg' as const,
  byteSize: 128,
  width: 3,
  height: 2,
};

afterEach(() => vi.useRealTimers());

describe('SenseNova image generation', () => {
  it('按官方 U1.5 生图协议请求并验证 JPEG 尺寸', async () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ b64_json: jpeg.toString('base64') }] }));
    const generator = new SenseNovaImageGenerator(
      {
        baseUrl: 'https://token.sensenova.cn/v1',
        model: 'sensenova-u1.5-lite',
        apiKey: 'secret',
      },
      fetcher,
    );

    await expect(generator.generate('教学插画')).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      width: 3,
      height: 2,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://token.sensenova.cn/v1/images/generations',
      expect.objectContaining({ method: 'POST', dispatcher: expect.anything() }),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'sensenova-u1.5-lite',
      n: 1,
      size: '1024x1024',
      output_format: 'jpeg',
      response_format: 'b64_json',
      watermark: true,
      prompt_extend: false,
    });
  });

  it.each([
    ['超出单边上限', 4097, 1024],
    ['超出总像素上限', 4096, 4097],
  ])('拒绝%s的 JPEG 元数据', async (_name, width, height) => {
    const jpeg = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      (height >> 8) & 0xff,
      height & 0xff,
      (width >> 8) & 0xff,
      width & 0xff,
      0x03,
      0x01,
      0x11,
      0x00,
      0x02,
      0x11,
      0x00,
      0x03,
      0x11,
      0x00,
    ]);
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ data: [{ b64_json: jpeg.toString('base64') }] })),
      );
    const generator = new SenseNovaImageGenerator(
      {
        baseUrl: 'https://token.sensenova.cn/v1',
        model: 'sensenova-u1.5-lite',
        apiKey: 'secret',
      },
      fetcher,
    );

    await expect(generator.generate('教学插画')).rejects.toThrow('payload is invalid');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('瞬时网络失败时最多重试两次，明确 4xx 时不重试', async () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);
    const retryingFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: jpeg.toString('base64') }] }));
    const retryingGenerator = new SenseNovaImageGenerator(
      {
        baseUrl: 'https://token.sensenova.cn/v1',
        model: 'sensenova-u1.5-fast',
        apiKey: 'secret',
      },
      retryingFetch,
    );

    await expect(retryingGenerator.generate('教学插画')).resolves.toMatchObject({
      width: 3,
      height: 2,
    });
    expect(retryingFetch).toHaveBeenCalledTimes(2);

    const thirdAttemptFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: jpeg.toString('base64') }] }));
    const thirdAttemptGenerator = new SenseNovaImageGenerator(
      {
        baseUrl: 'https://token.sensenova.cn/v1',
        model: 'sensenova-u1.5-fast',
        apiKey: 'secret',
      },
      thirdAttemptFetch,
    );

    await expect(thirdAttemptGenerator.generate('教学插画')).resolves.toMatchObject({
      width: 3,
      height: 2,
    });
    expect(thirdAttemptFetch).toHaveBeenCalledTimes(3);

    const rejectedFetch = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const rejectedGenerator = new SenseNovaImageGenerator(
      {
        baseUrl: 'https://token.sensenova.cn/v1',
        model: 'sensenova-u1.5-fast',
        apiKey: 'secret',
      },
      rejectedFetch,
    );

    await expect(rejectedGenerator.generate('教学插画')).rejects.toThrow('status 400');
    expect(rejectedFetch).toHaveBeenCalledOnce();
  });

  it('总超时触发时会中止重试等待且不再发起请求', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const generator = new SenseNovaImageGenerator(
      {
        baseUrl: 'https://token.sensenova.cn/v1',
        model: 'sensenova-u1.5-fast',
        apiKey: 'secret',
        timeoutMs: 50,
      },
      fetcher,
    );
    const pending = generator.generate('教学插画');
    const rejection = expect(pending).rejects.toThrow('sensenova image timeout');
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('只为适合视觉拆解的完整解答构造无文字插画提示词', () => {
    expect(shouldGenerateIllustration(result)).toBe(true);
    expect(shouldGenerateIllustration({ ...result, mode: 'hint' })).toBe(false);
    expect(
      shouldGenerateIllustration({
        ...result,
        contentProfile: {
          contentKind: 'question',
          learningGoal: 'explain',
          goalSource: 'explicit',
          confidence: 'high',
        },
      }),
    ).toBe(true);
    expect(
      shouldGenerateIllustration({
        ...result,
        contentProfile: {
          contentKind: 'exercise',
          learningGoal: 'solve',
          goalSource: 'explicit',
          confidence: 'high',
        },
      }),
    ).toBe(false);
    expect(
      shouldGenerateIllustration({
        ...result,
        contentProfile: {
          contentKind: 'question',
          learningGoal: 'solve',
          goalSource: 'explicit',
          confidence: 'high',
        },
        steps: [
          {
            id: 'bfs-step',
            title: '按层扩散',
            blocks: [
              {
                type: 'diagram',
                diagram: {
                  type: 'flow',
                  direction: 'LR',
                  nodes: [
                    { id: 'start', label: '起点', shape: 'rounded', color: 'green' },
                    { id: 'next', label: '下一层', shape: 'rectangle', color: 'blue' },
                  ],
                  edges: [{ id: 'advance', from: 'start', to: 'next', style: 'solid' }],
                },
              },
            ],
          },
        ],
      }),
    ).toBe(true);
    const prompt = buildIllustrationPrompt(result);
    expect(prompt).toContain('唯一目标步骤：第 1 步“观察各层”');
    expect(prompt).toContain('不要生成文字、数字、公式');
    expect(prompt).not.toContain('理解组合');
  });

  it('原子扣减额度、保存资产并返回可下载结果', async () => {
    const state = await prepareState();
    const artifacts: IllustrationArtifactRepository = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue({ status: 'generated', asset: artifact }),
    };
    const image: GeneratedImage = {
      bytes: Buffer.from('jpeg'),
      mimeType: 'image/jpeg',
      width: 3,
      height: 2,
    };
    const generator = { generate: vi.fn().mockResolvedValue(image) };
    const service = new IllustrationService(
      state,
      { canAccess: vi.fn().mockResolvedValue(true) },
      artifacts,
      generator,
      () => now,
    );

    await expect(service.execute(actor, { requestId, boardId })).resolves.toMatchObject({
      data: {
        status: 'generated',
        asset: artifact,
        placement: {
          stepId: 'step-1',
          stepTitle: '观察各层',
          altText: expect.stringContaining('第 1 步'),
          caption: expect.stringContaining('从上往下观察'),
        },
        quota: { image: { dailyRemaining: 1, periodRemaining: 19 } },
      },
    });
    expect(generator.generate).toHaveBeenCalledWith(expect.stringContaining('唯一目标步骤'));
  });

  it('供应商失败时返还图片额度且不影响已经缓存的文字结果', async () => {
    const state = await prepareState();
    const service = new IllustrationService(
      state,
      { canAccess: vi.fn().mockResolvedValue(true) },
      {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
      },
      { generate: vi.fn().mockRejectedValue(new Error('provider failed')) },
      () => now,
    );

    await expect(service.execute(actor, { requestId, boardId })).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
    });
    await expect(state.status('user:user-1', now)).resolves.toMatchObject({
      image: { dailyRemaining: 2, periodRemaining: 20 },
    });
    await expect(state.getCached('user:user-1', requestId)).resolves.toMatchObject({
      result: { title: '汉堡的结构' },
    });
  });

  it('同一插画的网络重试会等待超过旧的五秒窗口且不会重复生图', async () => {
    vi.useFakeTimers();
    const state = await prepareState();
    await state.reserveImages('user:user-1', requestId, 1, now);
    const reads = Array.from({ length: 10 }, () => null);
    const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    for (const value of reads) read.mockResolvedValueOnce(value);
    read.mockResolvedValue({ status: 'generated', asset: artifact });
    const artifacts: IllustrationArtifactRepository = {
      read,
      write: vi.fn(),
    };
    const generator = { generate: vi.fn() };
    const service = new IllustrationService(
      state,
      { canAccess: vi.fn().mockResolvedValue(true) },
      artifacts,
      generator,
      () => now,
    );

    const pending = service.execute(actor, { requestId, boardId });
    await vi.advanceTimersByTimeAsync(6_500);

    await expect(pending).resolves.toMatchObject({
      data: { status: 'generated', asset: artifact },
    });
    expect(generator.generate).not.toHaveBeenCalled();
  });
});

describe('illustration artifact cache validation', () => {
  const actorHash = 'a'.repeat(64);
  const stored = {
    fileId: '00000000-0000-4000-8000-000000000020',
    objectPath: `${actorHash}/${requestId}/${'b'.repeat(64)}.jpg`,
    mimeType: 'image/jpeg',
    byteSize: 128,
    width: 3,
    height: 2,
  };

  it('accepts only the expected actor and request scoped object path', () => {
    expect(validateStoredIllustration(stored, actorHash, requestId)).toEqual(stored);
    expect(
      validateStoredIllustration(
        { ...stored, objectPath: `${'c'.repeat(64)}/${requestId}/${'b'.repeat(64)}.jpg` },
        actorHash,
        requestId,
      ),
    ).toBeNull();
    expect(
      validateStoredIllustration(
        { ...stored, objectPath: `${actorHash}/${requestId}/../other.jpg` },
        actorHash,
        requestId,
      ),
    ).toBeNull();
  });

  it.each([
    { field: 'fileId', value: 'not-a-uuid' },
    { field: 'mimeType', value: 'image/svg+xml' },
    { field: 'byteSize', value: 0 },
    { field: 'width', value: 4097 },
    { field: 'height', value: Number.NaN },
  ])('rejects invalid $field metadata', ({ field, value }) => {
    expect(
      validateStoredIllustration({ ...stored, [field]: value }, actorHash, requestId),
    ).toBeNull();
  });
});
