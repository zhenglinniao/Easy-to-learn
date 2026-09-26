import type { Redis } from '@upstash/redis';
import { describe, expect, it } from 'vitest';

import type { AiProviderConfig } from './ai-provider-config.js';
import {
  AdminModelPolicyStore,
  applyAdminModelPolicy,
  defaultAdminModelPolicy,
  toAdminModelPolicyView,
  validateAdminModelPolicy,
} from './admin-model-policy.js';

const configs: AiProviderConfig[] = [
  {
    id: 'deepseek',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'secret-primary',
    model: 'deepseek-flash',
    timeoutMs: 12_000,
    responseFormat: 'json_schema',
    wireApi: 'responses',
  },
];
const key = Buffer.alloc(32, 7).toString('base64');

describe('admin model policy', () => {
  it('对前端隐藏密钥，同时运行时仍保留密钥', () => {
    const policy = defaultAdminModelPolicy(configs);
    expect(toAdminModelPolicyView(policy).providers[0]).toEqual(
      expect.objectContaining({
        id: 'deepseek',
        hasApiKey: true,
        responseFormat: 'json_schema',
        wireApi: 'responses',
      }),
    );
    expect(JSON.stringify(toAdminModelPolicyView(policy))).not.toContain('secret-primary');
    expect(applyAdminModelPolicy(policy)[0]).toEqual(
      expect.objectContaining({
        apiKey: 'secret-primary',
        responseFormat: 'json_schema',
        wireApi: 'responses',
      }),
    );
  });

  it('支持新增 SenseNova，并在留空时保留既有密钥', () => {
    const current = defaultAdminModelPolicy(configs);
    const policy = validateAdminModelPolicy(
      {
        providers: [
          {
            id: 'deepseek',
            label: 'DeepSeek Flash',
            type: 'openai-compatible',
            enabled: true,
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-flash',
            timeoutMs: 10_000,
            responseFormat: 'json_schema',
            wireApi: 'responses',
          },
          {
            id: 'sensenova',
            label: 'SenseNova 6.8 Flash Lite',
            type: 'openai-compatible',
            enabled: true,
            baseUrl: 'https://token.sensenova.cn/v1',
            model: 'sensenova-6.8-flash-lite',
            timeoutMs: 10_000,
            responseFormat: 'prompt',
            wireApi: 'chat_completions',
            imageModel: 'sensenova-u1.5-fast',
            apiKey: 'secret-sensenova',
          },
        ],
      },
      configs,
      current,
    );
    expect(policy.providers[0]?.apiKey).toBe('secret-primary');
    expect(policy.providers[1]?.apiKey).toBe('secret-sensenova');
    expect(policy.providers[1]).toMatchObject({ imageModel: 'sensenova-u1.5-fast' });
  });

  it('将 SenseNova 的不兼容组合规范化为 Chat Completions 与提示词约束', () => {
    const policy = validateAdminModelPolicy(
      {
        providers: [
          {
            id: 'sensenova',
            label: 'SenseNova 6.8 Flash Lite',
            type: 'openai-compatible',
            enabled: true,
            baseUrl: 'https://token.sensenova.cn/v1',
            model: 'sensenova-6.8-flash-lite',
            timeoutMs: 12_000,
            responseFormat: 'json_schema',
            wireApi: 'responses',
            apiKey: 'secret-sensenova',
          },
        ],
      },
      configs,
    );

    expect(policy.providers[0]).toMatchObject({
      responseFormat: 'prompt',
      wireApi: 'chat_completions',
    });
    expect(toAdminModelPolicyView(policy).providers[0]).toMatchObject({
      responseFormat: 'prompt',
      wireApi: 'chat_completions',
      timeoutMs: 50_000,
    });
    expect(applyAdminModelPolicy(policy)[0]).toMatchObject({
      responseFormat: 'prompt',
      wireApi: 'chat_completions',
      timeoutMs: 50_000,
    });
  });

  it('允许单个 Provider 使用完整 50 秒总预算', () => {
    const policy = validateAdminModelPolicy(
      {
        providers: [
          {
            id: 'sensenova',
            label: 'SenseNova 6.8 Flash Lite',
            type: 'openai-compatible',
            enabled: true,
            baseUrl: 'https://token.sensenova.cn/v1',
            model: 'sensenova-6.8-flash-lite',
            timeoutMs: 50_000,
            responseFormat: 'prompt',
            wireApi: 'chat_completions',
            apiKey: 'secret-sensenova',
          },
        ],
      },
      configs,
    );

    expect(applyAdminModelPolicy(policy)[0]).toMatchObject({ timeoutMs: 50_000 });
  });

  it('拒绝内网/未知域名、无密钥启用和超过总超时预算', () => {
    const base = {
      id: 'new_model',
      label: '新模型',
      type: 'openai-compatible',
      enabled: true,
      model: 'model',
      timeoutMs: 10_000,
      responseFormat: 'prompt',
      wireApi: 'chat_completions',
      apiKey: 'secret',
    };
    expect(() =>
      validateAdminModelPolicy({ providers: [{ ...base, baseUrl: 'http://127.0.0.1' }] }, configs),
    ).toThrow('HTTPS URL');
    expect(() =>
      validateAdminModelPolicy(
        { providers: [{ ...base, baseUrl: 'https://evil.example' }] },
        configs,
      ),
    ).toThrow('允许列表');
    expect(() =>
      validateAdminModelPolicy(
        { providers: [{ ...base, baseUrl: 'https://api.deepseek.com', apiKey: undefined }] },
        configs,
      ),
    ).toThrow('必须配置 API Key');
    expect(() =>
      validateAdminModelPolicy(
        {
          providers: [
            { ...base, id: 'a', baseUrl: 'https://api.deepseek.com', timeoutMs: 20_000 },
            { ...base, id: 'b', baseUrl: 'https://api.deepseek.com', timeoutMs: 20_000 },
            { ...base, id: 'c', baseUrl: 'https://api.deepseek.com', timeoutMs: 20_000 },
          ],
        },
        configs,
      ),
    ).toThrow('累计超时');
  });

  it('不会把包含官方域名字样的攻击者域名识别为生图供应商', () => {
    const spoofedConfigs: AiProviderConfig[] = [
      {
        id: 'spoofed',
        type: 'openai-compatible',
        baseUrl: 'https://sensenova.cn.evil.example/v1',
        model: 'model',
        timeoutMs: 12_000,
        responseFormat: 'prompt',
        wireApi: 'chat_completions',
        apiKey: 'environment-secret',
      },
    ];
    expect(() =>
      validateAdminModelPolicy(
        {
          providers: [
            {
              id: 'spoofed',
              label: 'Spoofed',
              type: 'openai-compatible',
              enabled: true,
              model: 'model',
              imageModel: 'sensenova-u1.5-fast',
              timeoutMs: 12_000,
              responseFormat: 'prompt',
              wireApi: 'chat_completions',
              baseUrl: 'https://sensenova.cn.evil.example/v1',
              apiKey: 'secret',
            },
          ],
        },
        spoofedConfigs,
      ),
    ).toThrow('只能配置在商汤日日新 Provider');
  });

  it('写入 Redis 的配置整体加密，不包含明文密钥', async () => {
    let stored = '';
    const redis = {
      get: async () => null,
      set: async (_key: string, value: string) => {
        stored = value;
        return 'OK';
      },
    } as unknown as Redis;
    const store = new AdminModelPolicyStore(redis, key);
    await store.write(configs, defaultAdminModelPolicy(configs), 'admin-id');
    expect(stored).not.toContain('secret-primary');
    expect(stored).not.toContain('deepseek-flash');
  });

  it('仅在配置键确实不存在时使用环境默认值', async () => {
    const redis = {
      get: async () => null,
    } as unknown as Redis;
    const store = new AdminModelPolicyStore(redis, key);

    await expect(store.read(configs)).resolves.toEqual(defaultAdminModelPolicy(configs));
  });

  it('不会把 Redis 故障或密文损坏伪装成配置被重置', async () => {
    const unavailable = new AdminModelPolicyStore(
      { get: async () => Promise.reject(new Error('redis offline')) } as unknown as Redis,
      key,
    );
    await expect(unavailable.read(configs)).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: '模型配置存储暂时不可用',
    });

    const corrupted = new AdminModelPolicyStore(
      { get: async () => 'not-an-encrypted-policy' } as unknown as Redis,
      key,
    );
    await expect(corrupted.read(configs)).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: '已保存的模型配置无法读取',
    });
  });
});
