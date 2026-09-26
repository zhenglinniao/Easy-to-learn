import { describe, expect, it } from 'vitest';

import type { AdminProviderView } from './client';
import {
  deepseekDirectModels,
  imageModelOptionsFor,
  modelOptionsFor,
  modelSelectionPatch,
  sensenovaImageModels,
  sensenovaTutorModels,
} from './modelCatalog';

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

  it('选择已知模型时同步 Model ID 与显示名称', () => {
    const deepseek = provider('deepseek', 'https://api.deepseek.com');
    expect(modelSelectionPatch(deepseek, 'deepseek-v4-pro')).toEqual({
      model: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
    });
  });

  it('商汤配置提供两个独立的 U1.5 生图模型', () => {
    const options = imageModelOptionsFor(provider('sensenova', 'https://token.sensenova.cn/v1'));
    expect(options).toEqual(sensenovaImageModels);
    expect(options?.map(({ id }) => id)).toEqual(['sensenova-u1.5-lite', 'sensenova-u1.5-fast']);
    expect(imageModelOptionsFor(provider('deepseek', 'https://api.deepseek.com'))).toBeNull();
  });
});
