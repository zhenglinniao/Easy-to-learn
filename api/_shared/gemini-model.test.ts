import type { TutorRequest } from '@easy-to-learn/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    readonly models = { generateContent };
  },
}));

import { GeminiTutorModel } from './gemini-model.js';
import { ProviderTimeoutError, ProviderUnavailableError } from './tutor-service.js';

const request: TutorRequest = {
  requestId: 'gemini-request-1',
  schemaVersion: 1,
  boardId: 'local_board-1',
  mode: 'hint',
  text: '请解释平行线',
  locale: 'zh-CN',
  source: {
    elementIds: ['shape-1'],
    selectionBounds: { x: 0, y: 0, width: 100, height: 60 },
    contentHash: 'hash-gemini-1',
  },
};

describe('GeminiTutorModel', () => {
  beforeEach(() => {
    generateContent.mockReset();
  });

  it('发送结构化图文请求并覆盖不可信元数据', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        schemaVersion: 1,
        mode: 'hint',
        title: '平行线提示',
        steps: [],
        metadata: { model: 'forged', promptVersion: 'forged' },
      }),
    });
    const model = new GeminiTutorModel(
      'server-secret',
      1_000,
      'gemini-test',
      undefined,
      'v1',
      'primary',
    );

    await expect(
      model.generate({ ...request, image: { mimeType: 'image/png', base64: 'YQ==' } }),
    ).resolves.toMatchObject({
      metadata: { model: 'primary/gemini-test', promptVersion: 'v1' },
    });

    const input = generateContent.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      model: 'gemini-test',
      contents: [
        {
          role: 'user',
          parts: [
            { text: expect.stringContaining('请解释平行线') },
            { inlineData: { mimeType: 'image/png', data: 'YQ==' } },
          ],
        },
      ],
      config: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseJsonSchema: expect.any(Object),
        systemInstruction: expect.any(String),
        abortSignal: expect.any(AbortSignal),
      },
    });
  });

  it('仅在服务端解析上传图片，格式纠错时关闭随机性', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ schemaVersion: 1, mode: 'hint', title: '提示', steps: [] }),
    });
    const resolveImage = vi.fn().mockResolvedValue('YmFzZTY0');
    const model = new GeminiTutorModel('secret', 1_000, 'gemini-test', resolveImage);

    await model.generate(
      {
        ...request,
        image: { mimeType: 'image/jpeg', uploadPath: 'user/board/source.jpg' },
      },
      '请修正 JSON',
    );

    expect(resolveImage).toHaveBeenCalledWith(
      request.requestId,
      'user/board/source.jpg',
      'image/jpeg',
    );
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      contents: [
        {
          parts: [
            { text: expect.stringContaining('请修正 JSON') },
            { inlineData: { mimeType: 'image/jpeg', data: 'YmFzZTY0' } },
          ],
        },
      ],
      config: { temperature: 0 },
    });
  });

  it('拒绝无解析器的上传图片', async () => {
    const model = new GeminiTutorModel('secret');

    await expect(
      model.generate({
        ...request,
        image: { mimeType: 'image/png', uploadPath: 'user/board/source.png' },
      }),
    ).rejects.toThrow('图片上传服务未配置');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('将 SDK 失败与超时转换为统一 Provider 错误', async () => {
    generateContent.mockRejectedValueOnce(new Error('upstream failed'));
    await expect(new GeminiTutorModel('secret').generate(request)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    generateContent.mockImplementationOnce(
      ({ config }: { config: { abortSignal: AbortSignal } }) =>
        new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    await expect(new GeminiTutorModel('secret', 1).generate(request)).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
  });
});
