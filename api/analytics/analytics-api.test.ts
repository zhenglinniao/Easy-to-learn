import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc })),
}));

import type { HttpRequest, HttpResponse } from '../_shared/http.js';
import metricsHandler from './metrics.js';
import visitHandler from './visit.js';

const createResponse = () => {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  let ended = false;
  const response: HttpResponse = {
    status(code) {
      statusCode = code;
      return response;
    },
    setHeader(name, value) {
      headers.set(name, value);
    },
    json(value) {
      body = value;
    },
    end() {
      ended = true;
    },
  };
  return { response, result: () => ({ headers, statusCode, body, ended }) };
};

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.ANALYTICS_HASH_SECRET = 'analytics-secret';
  process.env.APP_ORIGINS = 'https://easy.example.com';
  rpc.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('analytics API', () => {
  it('记录允许来源的访问并签发 HttpOnly 访客标识', async () => {
    rpc.mockResolvedValue({ error: null });
    const { response, result } = createResponse();
    const request: HttpRequest = {
      method: 'POST',
      headers: { origin: 'https://easy.example.com' },
    };

    await visitHandler(request, response);

    expect(result().statusCode).toBe(204);
    expect(result().ended).toBe(true);
    expect(result().headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(rpc).toHaveBeenCalledWith(
      'record_analytics_visit',
      expect.objectContaining({ p_visitor_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it('拒绝非允许来源写入统计', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { response, result } = createResponse();

    await visitHandler({ method: 'POST', headers: { origin: 'https://evil.example' } }, response);

    expect(result().statusCode).toBe(403);
    expect(result().body).toMatchObject({ code: 'FORBIDDEN' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('返回公开聚合指标并设置边缘缓存', async () => {
    rpc.mockResolvedValue({
      data: [{ total_visits: 12, visitors_30d: 8, registered_users: 4, cloud_boards: 6 }],
      error: null,
    });
    const { response, result } = createResponse();

    await metricsHandler({ method: 'GET', headers: {} }, response);

    expect(result().statusCode).toBe(200);
    expect(result().headers.get('Cache-Control')).toContain('s-maxage=300');
    expect(result().body).toMatchObject({
      data: { totalVisits: 12, visitors30d: 8, registeredUsers: 4, cloudBoards: 6 },
    });
  });

  it('依赖失败时返回可重试错误且不泄露数据库信息', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const { response, result } = createResponse();

    await metricsHandler({ method: 'GET', headers: {} }, response);

    expect(result().statusCode).toBe(503);
    expect(result().body).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
    expect(JSON.stringify(result().body)).not.toContain('private database detail');
  });
});
