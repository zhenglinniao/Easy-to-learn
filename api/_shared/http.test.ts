import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  disableResponseCaching,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from './http.js';
import { ApiFault } from './fault.js';

const request = (method: string, headers: HttpRequest['headers']): HttpRequest => ({
  method,
  headers,
});

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
      requireAllowedOrigin(request('GET', { referer: 'https://easy.example.com/admin?page=1' })),
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

describe('disableResponseCaching', () => {
  it('marks private API responses as non-cacheable', () => {
    const setHeader = vi.fn();
    disableResponseCaching({ setHeader } as unknown as HttpResponse);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
  });
});

describe('sendError', () => {
  it('replaces an unsafe caller-provided request id before writing response headers', () => {
    const setHeader = vi.fn();
    const json = vi.fn();
    const response = {
      setHeader,
      status: vi.fn().mockReturnThis(),
      json,
    } as unknown as HttpResponse;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      sendError(response, new ApiFault('INVALID_INPUT', 'bad request'), 'bad\r\nheader'),
    ).not.toThrow();
    const traceHeader = setHeader.mock.calls.find(([name]) => name === 'X-Request-Id')?.[1];
    expect(traceHeader).toMatch(/^[0-9a-f-]{36}$/);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ requestId: traceHeader }));
  });

  it('publishes a bounded Retry-After header only for retryable faults', () => {
    const setHeader = vi.fn();
    const response = {
      setHeader,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as HttpResponse;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    sendError(
      response,
      new ApiFault('RATE_LIMITED', '请稍后重试', { retryAfterSeconds: 90_000.2 }),
      'retry-1',
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '86400');

    setHeader.mockClear();
    sendError(
      response,
      new ApiFault('QUOTA_EXCEEDED', '额度已用完', { retryAfterSeconds: 60 }),
      'quota-1',
    );
    expect(setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
  });
});
