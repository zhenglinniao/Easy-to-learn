import { afterEach, describe, expect, it } from 'vitest';

import { requireAllowedOrigin, type HttpRequest } from './http.js';

const request = (
  method: string,
  headers: HttpRequest['headers'],
): HttpRequest => ({ method, headers });

afterEach(() => {
  delete process.env.APP_ORIGINS;
});

describe('requireAllowedOrigin', () => {
  it('接受白名单中的 Origin', () => {
    process.env.APP_ORIGINS = 'https://easy.example.com';
    expect(() =>
      requireAllowedOrigin(request('PATCH', { origin: 'https://easy.example.com' })),
    ).not.toThrow();
  });

  it('允许同源 GET 在没有 Origin 时通过 Referer 校验', () => {
    process.env.APP_ORIGINS = 'https://easy.example.com';
    expect(() =>
      requireAllowedOrigin(
        request('GET', { referer: 'https://easy.example.com/admin?page=1' }),
      ),
    ).not.toThrow();
  });

  it('允许浏览器明确标记为 same-origin 的安全读取请求', () => {
    process.env.APP_ORIGINS = 'https://easy.example.com';
    expect(() =>
      requireAllowedOrigin(request('GET', { 'sec-fetch-site': 'same-origin' })),
    ).not.toThrow();
  });

  it('拒绝跨站来源和缺少 Origin 的写操作', () => {
    process.env.APP_ORIGINS = 'https://easy.example.com';
    expect(() =>
      requireAllowedOrigin(request('GET', { referer: 'https://evil.example/admin' })),
    ).toThrow('请求来源不被允许');
    expect(() =>
      requireAllowedOrigin(request('PATCH', { 'sec-fetch-site': 'same-origin' })),
    ).toThrow('请求来源不被允许');
  });
});
