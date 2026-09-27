import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/react', () => ({ init: vi.fn(), captureException: vi.fn() }));

import * as Sentry from '@sentry/react';

import {
  captureMonitoringException,
  initializeMonitoring,
  sanitizeMonitoringException,
  sanitizeMonitoringUrl,
} from './monitoring';

describe('浏览器监控', () => {
  it('没有 DSN 时保持禁用', async () => {
    await expect(initializeMonitoring({ environment: 'local' })).resolves.toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('初始化时禁用 PII 和性能采样', async () => {
    await expect(
      initializeMonitoring({ dsn: 'https://public@example.test/1', environment: 'preview' }),
    ).resolves.toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@example.test/1',
        environment: 'preview',
        sendDefaultPii: false,
        tracesSampleRate: 0,
      }),
    );
  });

  it('仅在监控成功初始化后上报错误', async () => {
    await initializeMonitoring({
      dsn: 'https://public@example.test/1',
      environment: 'test',
    });
    const error = new Error('render failed');

    await expect(captureMonitoringException(error, { componentStack: 'App' })).resolves.toBe(true);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      contexts: { react: { componentStack: 'App' } },
    });
    const captured = vi.mocked(Sentry.captureException).mock.calls.at(-1)?.[0];
    expect(captured).toMatchObject({ message: 'Application error' });
  });

  it('移除 URL 查询参数和片段，避免泄露凭据或题目', () => {
    expect(sanitizeMonitoringUrl('/canvas/board-1?token=secret#answer')).toBe(
      'http://localhost:3000/canvas/board-1',
    );
    expect(sanitizeMonitoringUrl('not a url?token=secret')).toBe(
      'http://localhost:3000/not%20a%20url',
    );
  });

  it('错误消息和堆栈 URL 不包含用户内容或查询参数', () => {
    const error = new Error('题目答案是 secret');
    error.stack =
      'Error: 题目答案是 secret\n    at https://example.test/app.js?token=secret#answer:1:2';

    const sanitized = sanitizeMonitoringException(error);

    expect(sanitized.message).toBe('Application error');
    expect(sanitized.stack).toContain('https://example.test/app.js');
    expect(sanitized.stack).not.toContain('secret');
    expect(sanitized.stack).not.toContain('answer');
  });

  it('丢弃控制台面包屑并清除请求正文与消息', async () => {
    await initializeMonitoring({
      dsn: 'https://public@example.test/1',
      environment: 'test',
    });
    const options = vi.mocked(Sentry.init).mock.calls.at(-1)?.[0];

    expect(
      options?.beforeBreadcrumb?.({ category: 'console', message: 'secret answer' }, {}),
    ).toBeNull();
    const breadcrumb = options?.beforeBreadcrumb?.(
      {
        category: 'fetch',
        message: 'request with secret',
        data: {
          url: 'https://example.test/api?t=secret',
          method: 'POST',
          request_body: 'private question',
        },
      },
      {},
    );
    expect(breadcrumb).toMatchObject({
      data: { url: 'https://example.test/api', method: 'POST' },
    });
    expect(breadcrumb).not.toHaveProperty('message');
  });
});
