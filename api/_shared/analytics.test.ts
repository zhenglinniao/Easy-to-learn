import { describe, expect, it } from 'vitest';

import {
  createVisitorId,
  hashVisitorId,
  serializeAnalyticsCookie,
  toPublicProductMetrics,
  validVisitorId,
} from './analytics';

describe('product analytics helpers', () => {
  it('签发不可由前端脚本读取的匿名访客 Cookie', () => {
    const visitorId = createVisitorId();

    expect(validVisitorId(visitorId)).toBe(true);
    expect(serializeAnalyticsCookie(visitorId)).toContain('HttpOnly; Secure; SameSite=Lax');
  });

  it('使用部署密钥生成稳定且不可逆的访客摘要', () => {
    const hash = hashVisitorId('11111111-1111-4111-8111-111111111111', 'secret');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashVisitorId('11111111-1111-4111-8111-111111111111', 'secret'));
    expect(hash).not.toContain('11111111');
  });

  it('把数据库聚合转换为稳定的非负整数协议', () => {
    expect(
      toPublicProductMetrics(
        {
          total_visits: 12,
          visitors_30d: '8',
          registered_users: -1,
          cloud_boards: null,
        },
        new Date('2026-09-26T00:00:00.000Z'),
      ),
    ).toEqual({
      totalVisits: 12,
      visitors30d: 8,
      registeredUsers: 0,
      cloudBoards: 0,
      generatedAt: '2026-09-26T00:00:00.000Z',
    });
  });
});
