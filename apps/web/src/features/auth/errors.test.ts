import { describe, expect, it } from 'vitest';

import { toAuthMessage } from './errors';

describe('toAuthMessage', () => {
  it('把公开错误码转换为稳定中文，不透传供应商原文', () => {
    expect(toAuthMessage({ code: 'invalid_credentials', message: 'provider detail' })).toBe(
      '邮箱或密码不正确。',
    );
    expect(toAuthMessage({ code: 'unknown_internal', message: 'sensitive detail' })).toBe(
      '认证服务暂时不可用，请稍后重试。',
    );
  });

  it('对限流返回可操作提示', () => {
    expect(toAuthMessage({ status: 429 })).toBe('操作过于频繁，请稍后再试。');
  });
});
