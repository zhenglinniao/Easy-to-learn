import { describe, expect, it } from 'vitest';

import { isAuthoritativeBoardAccessError, toBoardMessage } from './errors';

describe('toBoardMessage', () => {
  it('把服务端业务错误转换为可执行的用户提示', () => {
    expect(toBoardMessage({ message: 'STORAGE_QUOTA_EXCEEDED' })).toContain('达到上限');
    expect(toBoardMessage({ message: 'BOARD_NOT_FOUND' })).toContain('不存在');
    expect(toBoardMessage({ status: 403 })).toContain('访问权限');
    expect(toBoardMessage({ message: 'AUTH_REQUIRED' })).toContain('重新登录');
  });

  it('不会把未知服务端细节直接暴露给用户', () => {
    expect(toBoardMessage({ code: '42883', message: 'internal database detail' })).toBe(
      '画板服务暂时不可用，请稍后重试。',
    );
  });
});

describe('isAuthoritativeBoardAccessError', () => {
  it.each([
    { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    { status: 403, message: 'permission denied' },
    { status: 401, message: 'unauthorized' },
    { message: 'BOARD_NOT_FOUND' },
    { message: 'JWT expired' },
  ])('识别不可使用离线缓存掩盖的权限结果 %#', (error) => {
    expect(isAuthoritativeBoardAccessError(error)).toBe(true);
  });

  it('网络暂时失败时仍允许同账户缓存离线回退', () => {
    expect(isAuthoritativeBoardAccessError(new TypeError('fetch failed'))).toBe(false);
  });
});
