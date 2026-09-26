import type { TutorRequest } from '@easy-to-learn/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  AiProviderConfigurationError,
  isAiProviderEnvironmentConfigured,
  loadAiProviderConfigs,
} from './ai-provider-config.js';
import { FallbackTutorModel, createTutorModelFromEnvironment } from './ai-provider.js';
import { ProviderTimeoutError, type TutorModel } from './tutor-service.js';

const request: TutorRequest = {
  requestId: 'request-provider-1',
  schemaVersion: 1,
  boardId: 'local_board-1',
  mode: 'hint',
  text: '如何证明两条线平行？',
  locale: 'zh-CN',
  source: {
    elementIds: ['shape-1'],
    selectionBounds: { x: 0, y: 0, width: 120, height: 80 },
    contentHash: 'hash-provider-1',
  },
};

const modelResult = {
  schemaVersion: 1,
  mode: 'hint',
  title: '平行线提示',
  steps: [],
};

describe('AI Provider 配置', () => {
  it('按声明顺序加载 Gemini 与 OpenAI-compatible Provider', () => {
    const configs = loadAiProviderConfigs({
      AI_PROVIDERS: 'primary, backup',
      AI_PROVIDER_PRIMARY_TYPE: 'openai-compatible',
      AI_PROVIDER_PRIMARY_BASE_URL: 'https://api.example.com/v1/',
      AI_PROVIDER_PRIMARY_API_KEY: 'primary-secret',
      AI_PROVIDER_PRIMARY_MODEL: 'vision-model',
      AI_PROVIDER_PRIMARY_RESPONSE_FORMAT: 'json_object',
      AI_PROVIDER_BACKUP_TYPE: 'gemini',
      AI_PROVIDER_BACKUP_API_KEY: 'backup-secret',
      AI_PROVIDER_BACKUP_MODEL: 'gemini-model',
      AI_PROVIDER_BACKUP_TIMEOUT_MS: '12000',
    });

    expect(configs).toEqual([
      {
        id: 'primary',
        type: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'primary-secret',
        model: 'vision-model',
        responseFormat: 'json_object',
        wireApi: 'chat_completions',
        timeoutMs: 25_000,
      },
      {
        id: 'backup',
        type: 'gemini',
        apiKey: 'backup-secret',
        model: 'gemini-model',
        timeoutMs: 12_000,
      },
    ]);
  });

  it('校验 Responses API 与推理强度配置', () => {
    expect(
      loadAiProviderConfigs({
        AI_PROVIDERS: 'deepseek',
        AI_PROVIDER_DEEPSEEK_TYPE: 'openai-compatible',
        AI_PROVIDER_DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
        AI_PROVIDER_DEEPSEEK_MODEL: 'deepseek-flash',
        AI_PROVIDER_DEEPSEEK_WIRE_API: 'responses',
        AI_PROVIDER_DEEPSEEK_RESPONSE_FORMAT: 'json_schema',
        AI_PROVIDER_DEEPSEEK_REASONING_EFFORT: 'none',
      }),
    ).toMatchObject([{ wireApi: 'responses', reasoningEffort: 'none' }]);
    expect(() =>
      loadAiProviderConfigs({
        AI_PROVIDERS: 'bad',
        AI_PROVIDER_BAD_TYPE: 'openai-compatible',
        AI_PROVIDER_BAD_BASE_URL: 'https://api.example.com',
        AI_PROVIDER_BAD_MODEL: 'model',
        AI_PROVIDER_BAD_WIRE_API: 'legacy',
      }),
    ).toThrow(/WIRE_API/);
  });

  it('兼容原 GEMINI_API_KEY 配置，并拒绝不完整或不安全的配置', () => {
    expect(
      loadAiProviderConfigs({ GEMINI_API_KEY: 'legacy-key', AI_MODEL: 'legacy-model' }),
    ).toEqual([
      {
        id: 'gemini',
        type: 'gemini',
        apiKey: 'legacy-key',
        model: 'legacy-model',
        timeoutMs: 50_000,
      },
    ]);
    expect(isAiProviderEnvironmentConfigured({})).toBe(false);
    expect(() =>
      loadAiProviderConfigs({
        AI_PROVIDERS: 'local',
        AI_PROVIDER_LOCAL_TYPE: 'openai-compatible',
        AI_PROVIDER_LOCAL_MODEL: 'local-model',
        AI_PROVIDER_LOCAL_BASE_URL: 'file:///tmp/model',
      }),
    ).toThrow(AiProviderConfigurationError);
    expect(() =>
      loadAiProviderConfigs({
        AI_PROVIDERS: 'one,two,three',
        AI_PROVIDER_ONE_TYPE: 'gemini',
        AI_PROVIDER_ONE_MODEL: 'model-one',
        AI_PROVIDER_ONE_API_KEY: 'secret-one',
        AI_PROVIDER_ONE_TIMEOUT_MS: '17000',
        AI_PROVIDER_TWO_TYPE: 'gemini',
        AI_PROVIDER_TWO_MODEL: 'model-two',
        AI_PROVIDER_TWO_API_KEY: 'secret-two',
        AI_PROVIDER_TWO_TIMEOUT_MS: '17000',
        AI_PROVIDER_THREE_TYPE: 'gemini',
        AI_PROVIDER_THREE_MODEL: 'model-three',
        AI_PROVIDER_THREE_API_KEY: 'secret-three',
        AI_PROVIDER_THREE_TIMEOUT_MS: '17000',
      }),
    ).toThrow(/累计超时/);
  });
});

describe('AI Provider 执行', () => {
  it('主 Provider 超时时使用后备 Provider', async () => {
    const primary: TutorModel = {
      generate: vi.fn().mockRejectedValue(new ProviderTimeoutError('timeout')),
    };
    const backup: TutorModel = { generate: vi.fn().mockResolvedValue(modelResult) };
    const model = new FallbackTutorModel([primary, backup]);

    await expect(model.generate(request)).resolves.toBe(modelResult);
    expect(primary.generate).toHaveBeenCalledOnce();
    expect(backup.generate).toHaveBeenCalledOnce();
  });

  it('通过 OpenAI-compatible 接口发送图文请求并覆盖可信元数据', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ ...modelResult, metadata: '伪造值' }) } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const model = createTutorModelFromEnvironment(
      vi.fn(),
      {
        AI_PROVIDERS: 'deepseek',
        AI_PROVIDER_DEEPSEEK_TYPE: 'openai-compatible',
        AI_PROVIDER_DEEPSEEK_BASE_URL: 'https://api.deepseek.example/v1',
        AI_PROVIDER_DEEPSEEK_API_KEY: 'server-only-secret',
        AI_PROVIDER_DEEPSEEK_MODEL: 'deepseek-chat',
        AI_PROVIDER_DEEPSEEK_RESPONSE_FORMAT: 'json_object',
        AI_PROMPT_VERSION: 'v1',
      },
      fetchMock,
    );

    await expect(
      model.generate({ ...request, image: { mimeType: 'image/png', base64: 'YQ==' } }),
    ).resolves.toMatchObject({
      metadata: { model: 'deepseek/deepseek-chat', promptVersion: 'v1' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.example/v1/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer server-only-secret' });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'deepseek-chat',
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });
    expect(body.messages[1].content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,YQ==' },
    });
  });

  it('提示词约束模式会发送完整 Tutor Schema 且不声明 response_format', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelResult) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const model = createTutorModelFromEnvironment(
      vi.fn(),
      {
        AI_PROVIDERS: 'sensenova',
        AI_PROVIDER_SENSENOVA_TYPE: 'openai-compatible',
        AI_PROVIDER_SENSENOVA_BASE_URL: 'https://token.sensenova.cn/v1',
        AI_PROVIDER_SENSENOVA_API_KEY: 'server-only-secret',
        AI_PROVIDER_SENSENOVA_MODEL: 'sensenova-6.8-flash-lite',
        AI_PROVIDER_SENSENOVA_RESPONSE_FORMAT: 'prompt',
      },
      fetchMock,
    );

    await model.generate(request);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const prompt = body.messages[1].content[0].text as string;

    expect(body.response_format).toBeUndefined();
    expect(prompt).toContain('以下 JSON Schema 是唯一允许的输出结构');
    expect(prompt).toContain('"additionalProperties"');
    expect(prompt).toContain('"contentProfile"');
  });

  it('SenseNova 瞬时断连时会在同一超时预算内重试一次', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelResult) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const model = createTutorModelFromEnvironment(
      vi.fn(),
      {
        AI_PROVIDERS: 'sensenova',
        AI_PROVIDER_SENSENOVA_TYPE: 'openai-compatible',
        AI_PROVIDER_SENSENOVA_BASE_URL: 'https://token.sensenova.cn/v1',
        AI_PROVIDER_SENSENOVA_API_KEY: 'server-only-secret',
        AI_PROVIDER_SENSENOVA_MODEL: 'sensenova-6.8-flash-lite',
        AI_PROVIDER_SENSENOVA_RESPONSE_FORMAT: 'prompt',
      },
      fetchMock,
    );

    await expect(model.generate(request)).resolves.toMatchObject({
      metadata: { model: 'sensenova/sensenova-6.8-flash-lite' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('通过 Responses API 发送 JSON Schema、图像与关闭推理参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: JSON.stringify({ ...modelResult, metadata: 'fake' }) },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const model = createTutorModelFromEnvironment(
      vi.fn(),
      {
        AI_PROVIDERS: 'deepseek',
        AI_PROVIDER_DEEPSEEK_TYPE: 'openai-compatible',
        AI_PROVIDER_DEEPSEEK_BASE_URL: 'https://api.deepseek.example',
        AI_PROVIDER_DEEPSEEK_API_KEY: 'server-only-secret',
        AI_PROVIDER_DEEPSEEK_MODEL: 'deepseek-flash',
        AI_PROVIDER_DEEPSEEK_WIRE_API: 'responses',
        AI_PROVIDER_DEEPSEEK_RESPONSE_FORMAT: 'json_schema',
        AI_PROVIDER_DEEPSEEK_REASONING_EFFORT: 'none',
        AI_PROMPT_VERSION: 'v1',
      },
      fetchMock,
    );

    await model.generate(
      { ...request, image: { mimeType: 'image/png', base64: 'YQ==' } },
      '补齐每一步缺失的图解',
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe('https://api.deepseek.example/responses');
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      temperature: 0,
      reasoning: { effort: 'none' },
      text: { format: { type: 'json_schema', name: 'tutor_result_v1' } },
    });
    expect(body.input[0].content).toContainEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,YQ==',
      detail: 'original',
    });
  });
});
