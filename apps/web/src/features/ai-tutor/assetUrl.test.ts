import { describe, expect, it } from 'vitest';

import { isSafeAssetUrl } from './assetUrl';

const configuredOrigin = new URL(
  import.meta.env.VITE_SUPABASE_URL ?? 'https://storage.example.test',
).origin;

describe('isSafeAssetUrl', () => {
  it('接受 HTTPS 签名资源并拒绝危险协议与外部明文地址', () => {
    expect(isSafeAssetUrl(`${configuredOrigin}/storage/v1/object?token=opaque`)).toBe(true);
    expect(isSafeAssetUrl('https://unrelated.example.test/object')).toBe(
      import.meta.env.VITE_SUPABASE_URL ? false : true,
    );
    expect(isSafeAssetUrl('http://storage.example.test/object')).toBe(false);
    expect(isSafeAssetUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeAssetUrl('not-a-url')).toBe(false);
  });

  it('开发模式只额外允许回环地址', () => {
    const configuredIsLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(configuredOrigin).hostname,
    );
    expect(isSafeAssetUrl('http://127.0.0.1:54321/storage/v1/object')).toBe(
      import.meta.env.DEV &&
        (!import.meta.env.VITE_SUPABASE_URL ||
          (configuredIsLoopback && configuredOrigin === 'http://127.0.0.1:54321')),
    );
  });
});
