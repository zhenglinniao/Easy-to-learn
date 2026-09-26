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
            { ...base, id: 'a', baseUrl: 'https://api.deepseek.com', timeoutMs: 13_000 },
            { ...base, id: 'b', baseUrl: 'https://api.deepseek.com', timeoutMs: 13_000 },
          ],
        },
        configs,
      ),
    ).toThrow('累计超时');
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
});
