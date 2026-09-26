import { describe, expect, it } from 'vitest';

import { SenseNovaImageGenerator } from './illustration-service.js';

const runIntegration = process.env.RUN_IMAGE_INTEGRATION === '1';

describe.skipIf(!runIntegration)('真实 SenseNova U1.5 生图', () => {
  it('返回经过尺寸与大小校验的 JPEG', async () => {
    const apiKey = process.env.SENSENOVA_TEST_API_KEY;
    if (!apiKey) throw new Error('SENSENOVA_TEST_API_KEY 未配置');
    const generator = new SenseNovaImageGenerator({
      baseUrl: 'https://token.sensenova.cn/v1',
      model: 'sensenova-u1.5-fast',
      apiKey,
      timeoutMs: 90_000,
    });

    const image = await generator.generate(
      '一张简洁的无文字教学插画：三个圆点从左到右用箭头连接，表示按顺序推进；白色背景，手绘线稿，柔和配色，不要文字、数字、公式、品牌标志。',
    );

    expect(image.mimeType).toBe('image/jpeg');
    expect(image.bytes.length).toBeGreaterThan(1_000);
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
  }, 100_000);
});
