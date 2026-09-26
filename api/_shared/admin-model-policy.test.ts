import { describe, expect, it } from 'vitest';

import type { AiProviderConfig } from './ai-provider-config.js';
import {
  applyAdminModelPolicy,
  defaultAdminModelPolicy,
  validateAdminModelPolicy,
} from './admin-model-policy.js';

const configs: AiProviderConfig[] = [
  {
    id: 'primary',
    type: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret-primary',
    model: 'model-a',
    timeoutMs: 12_000,
    responseFormat: 'json_schema',
    wireApi: 'chat_completions',
  },
  {
    id: 'backup',
    type: 'gemini',
    apiKey: 'secret-backup',
    model: 'model-b',
    timeoutMs: 12_000,
  },
];

describe('admin model policy', () => {
  it('默认启用环境中已经配置的全部 Provider，且不暴露密钥', () => {
    const policy = defaultAdminModelPolicy(configs);
    expect(policy.providers).toEqual([
      { id: 'primary', enabled: true, model: 'model-a', timeoutMs: 12_000 },
      { id: 'backup', enabled: true, model: 'model-b', timeoutMs: 12_000 },
    ]);
    expect(JSON.stringify(policy)).not.toContain('secret');
  });

  it('支持动态排序、停用与模型覆盖，同时保留服务端密钥和地址', () => {
    const policy = validateAdminModelPolicy(
      {
        providers: [
          { id: 'backup', enabled: true, model: 'model-b-fast', timeoutMs: 8_000 },
          { id: 'primary', enabled: false, model: 'model-a', timeoutMs: 12_000 },
        ],
      },
      configs,
    );
    expect(applyAdminModelPolicy(configs, policy)).toEqual([
      expect.objectContaining({
        id: 'backup',
        model: 'model-b-fast',
        timeoutMs: 8_000,
        apiKey: 'secret-backup',
      }),
    ]);
  });

  it('拒绝关闭全部模型、未知 Provider 和超过总超时预算', () => {
    expect(() =>
      validateAdminModelPolicy(
        {
          providers: configs.map(({ id, model, timeoutMs }) => ({
            id,
            model,
            timeoutMs,
            enabled: false,
          })),
        },
        configs,
      ),
    ).toThrow('至少需要启用一个');
    expect(() =>
      validateAdminModelPolicy(
        {
          providers: [
            { id: 'unknown', enabled: true, model: 'x', timeoutMs: 1_000 },
            { id: 'backup', enabled: true, model: 'model-b', timeoutMs: 1_000 },
          ],
        },
        configs,
      ),
    ).toThrow('未知或重复');
    expect(() =>
      validateAdminModelPolicy(
        {
          providers: [
            { id: 'primary', enabled: true, model: 'model-a', timeoutMs: 13_000 },
            { id: 'backup', enabled: true, model: 'model-b', timeoutMs: 13_000 },
          ],
        },
        configs,
      ),
    ).toThrow('累计超时');
  });
});
