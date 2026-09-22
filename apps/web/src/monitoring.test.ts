import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/react', () => ({ init: vi.fn() }));

import * as Sentry from '@sentry/react';

import { initializeMonitoring, sanitizeMonitoringUrl } from './monitoring';

describe('浏览器监控', () => {
  it('没有 DSN 时保持禁用', () => {
    expect(initializeMonitoring({ environment: 'local' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('初始化时禁用 PII 和性能采样', () => {
    expect(
      initializeMonitoring({ dsn: 'https://public@example.test/1', environment: 'preview' }),
    ).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@example.test/1',
        environment: 'preview',
        sendDefaultPii: false,
        tracesSampleRate: 0,
      }),
    );
  });

  it('移除 URL 查询参数和片段，避免泄露凭据或题目', () => {
    expect(sanitizeMonitoringUrl('/canvas/board-1?token=secret#answer')).toBe(
      'http://localhost:3000/canvas/board-1',
    );
    expect(sanitizeMonitoringUrl('not a url?token=secret')).toBe(
      'http://localhost:3000/not%20a%20url',
    );
  });
});
