import { describe, expect, it } from 'vitest';

import { toBoardMessage } from './errors';

describe('toBoardMessage', () => {
  it('把服务端业务错误转换为可执行的用户提示', () => {
    expect(toBoardMessage({ message: 'STORAGE_QUOTA_EXCEEDED' })).toContain('达到上限');
    expect(toBoardMessage({ message: 'BOARD_NOT_FOUND' })).toContain('不存在');
    expect(toBoardMessage({ message: 'AUTH_REQUIRED' })).toContain('重新登录');
  });

  it('不会把未知服务端细节直接暴露给用户', () => {
    expect(toBoardMessage({ code: '42883', message: 'internal database detail' })).toBe(
      '画板服务暂时不可用，请稍后重试。',
    );
  });
});
