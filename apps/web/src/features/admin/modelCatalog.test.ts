import { describe, expect, it } from 'vitest';

import type { AdminProviderView } from './client';
import { deepseekDirectModels, modelOptionsFor, sensenovaTutorModels } from './modelCatalog';

const provider = (id: string, baseUrl: string): AdminProviderView => ({
  id,
  label: id,
  type: 'openai-compatible',
  enabled: true,
  baseUrl,
  model: 'placeholder',
  timeoutMs: 12_000,
  hasApiKey: true,
});

describe('管理员模型目录', () => {
  it('商汤平台只提供当前教学规划链路兼容的模型', () => {
    const options = modelOptionsFor(provider('sensenova', 'https://token.sensenova.cn/v1'));
    expect(options).toEqual(sensenovaTutorModels);
    expect(options?.map(({ id }) => id)).toEqual([
      'sensenova-6.8-flash-lite',
      'deepseek-v4-flash',
      'deepseek-flash',
      'glm-5.2',
      'kimi-k3',
    ]);
  });

  it('DeepSeek 直连显示官方接口模型选项', () => {
    expect(modelOptionsFor(provider('deepseek', 'https://api.deepseek.com'))).toEqual(
      deepseekDirectModels,
    );
  });
});
