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

  it('区分默认邮件服务限制、邮箱格式与服务端异常', () => {
    expect(toAuthMessage({ code: 'email_address_not_authorized' })).toBe(
      '验证邮件服务尚未完成生产配置，请联系支持人员。',
    );
    expect(toAuthMessage({ code: 'email_address_invalid' })).toBe(
      '请输入可以正常接收邮件的邮箱地址。',
    );
    expect(toAuthMessage({ code: 'unexpected_failure' })).toBe(
      '认证服务出现异常，请稍后重试；若持续发生请联系支持人员。',
    );
  });
});
