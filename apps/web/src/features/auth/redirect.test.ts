import { describe, expect, it } from 'vitest';

import { parseSafeRedirect } from './redirect';

describe('parseSafeRedirect', () => {
  it('保留允许的站内路径和查询参数', () => {
    expect(parseSafeRedirect('/canvas/local_abc-123?from=login')).toBe(
      '/canvas/local_abc-123?from=login',
    );
    expect(parseSafeRedirect('/boards')).toBe('/boards');
    expect(parseSafeRedirect('/reset-password')).toBe('/reset-password');
    expect(parseSafeRedirect('/admin')).toBe('/admin');
    expect(parseSafeRedirect('/canvas/89a5a57f-f335-453f-9383-8223825f45c4')).toBe(
      '/canvas/89a5a57f-f335-453f-9383-8223825f45c4',
    );
  });
  it('拒绝外部、协议相对、反斜线与未知路由', () => {
    expect(parseSafeRedirect('https://evil.example')).toBe('/boards');
    expect(parseSafeRedirect('//evil.example')).toBe('/boards');
    expect(parseSafeRedirect('/\\evil.example')).toBe('/boards');
    expect(parseSafeRedirect('/unknown')).toBe('/boards');
    expect(parseSafeRedirect('/canvas/not-a-cloud-id')).toBe('/boards');
    expect(parseSafeRedirect(`/canvas/local_${'a'.repeat(2_100)}`)).toBe('/boards');
  });
});
