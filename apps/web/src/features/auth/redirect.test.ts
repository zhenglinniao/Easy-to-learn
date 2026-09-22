import { describe, expect, it } from 'vitest';

import { parseSafeRedirect } from './redirect';

describe('parseSafeRedirect', () => {
  it('保留允许的站内路径和查询参数', () => {
    expect(parseSafeRedirect('/canvas/local_abc-123?from=login')).toBe(
      '/canvas/local_abc-123?from=login',
    );
    expect(parseSafeRedirect('/boards')).toBe('/boards');
  });
  it('拒绝外部、协议相对、反斜线与未知路由', () => {
    expect(parseSafeRedirect('https://evil.example')).toBe('/boards');
    expect(parseSafeRedirect('//evil.example')).toBe('/boards');
    expect(parseSafeRedirect('/\\evil.example')).toBe('/boards');
    expect(parseSafeRedirect('/admin')).toBe('/boards');
  });
});
