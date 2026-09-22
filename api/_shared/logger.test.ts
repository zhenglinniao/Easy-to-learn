import { describe, expect, it } from 'vitest';

import { ApiFault } from './fault';
import { createApiErrorLog } from './logger';

describe('服务端结构化日志', () => {
  it('只记录白名单诊断字段，不记录错误消息或请求内容', () => {
    const record = createApiErrorLog(
      new ApiFault('AI_PROVIDER_ERROR', '供应商返回了敏感内容', { prompt: '原题' }),
      'request-1',
      () => new Date('2026-09-23T00:00:00.000Z'),
    );

    expect(record).toEqual({
      timestamp: '2026-09-23T00:00:00.000Z',
      level: 'error',
      event: 'api_request_failed',
      requestId: 'request-1',
      code: 'AI_PROVIDER_ERROR',
      httpStatus: 502,
      retryable: true,
    });
    expect(JSON.stringify(record)).not.toContain('敏感内容');
    expect(JSON.stringify(record)).not.toContain('原题');
  });

  it('把预期的客户端错误标记为 warning', () => {
    expect(createApiErrorLog(new ApiFault('INVALID_INPUT', '输入错误'), 'request-2').level).toBe(
      'warning',
    );
  });
});
