import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const overview = vi.hoisted(() => vi.fn());
const updateModels = vi.hoisted(() => vi.fn());
const updateAccount = vi.hoisted(() => vi.fn());
const requireAdmin = vi.hoisted(() => vi.fn());
const resolveAdminAccess = vi.hoisted(() => vi.fn());

vi.mock('../_shared/admin.js', () => ({
  AdminService: class {
    overview = overview;
    updateModels = updateModels;
    updateAccount = updateAccount;
  },
  requireAdmin,
  resolveAdminAccess,
}));

import handler from './[action].js';

const createResponse = () => {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  const response: HttpResponse = {
    status(code) {
      statusCode = code;
      return response;
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    json(value) {
      body = value;
    },
    end() {},
  };
  return { response, result: () => ({ body, headers, statusCode }) };
};

const request = (
  action: string,
  method: string,
  body?: unknown,
  contentType = 'application/json',
): HttpRequest => ({
  method,
  url: `/api/admin/${action}`,
  body,
  headers: {
    origin: 'https://easy.example.com',
    'content-type': contentType,
  },
});

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  requireAdmin.mockReset().mockResolvedValue('00000000-0000-4000-8000-000000000001');
  resolveAdminAccess.mockReset().mockResolvedValue({
    isAdmin: true,
    userId: '00000000-0000-4000-8000-000000000001',
  });
  overview.mockReset().mockResolvedValue({ accounts: [], models: [], pagination: { total: 0 } });
  updateModels.mockReset().mockResolvedValue([]);
  updateAccount.mockReset().mockResolvedValue({ id: 'user-1', suspended: true });
});

afterEach(() => {
  delete process.env.APP_ORIGINS;
  vi.restoreAllMocks();
});

describe('/api/admin/[action]', () => {
  it('reports access without loading privileged admin data', async () => {
    const output = createResponse();
    await handler(request('access', 'GET'), output.response);

    expect(output.result()).toMatchObject({
      statusCode: 200,
      body: {
        data: { isAdmin: true, userId: '00000000-0000-4000-8000-000000000001' },
      },
    });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(output.result().headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('normalizes overview pagination and bounds the search input', async () => {
    const output = createResponse();
    await handler(
      {
        ...request('overview', 'GET'),
        url: `/api/admin/overview?page=999999&search=${'a'.repeat(180)}`,
      },
      output.response,
    );

    expect(overview).toHaveBeenCalledWith(10_000, 'a'.repeat(120));
    expect(output.result().statusCode).toBe(200);
  });

  it('updates model policy and account state only after administrator verification', async () => {
    const models = createResponse();
    await handler(request('models', 'PATCH', { providers: [] }), models.response);
    expect(updateModels).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', {
      providers: [],
    });

    const accounts = createResponse();
    await handler(
      request('accounts', 'PATCH', { userId: 'user-1', action: 'suspend' }),
      accounts.response,
    );
    expect(updateAccount).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', {
      userId: 'user-1',
      action: 'suspend',
    });
  });

  it('rejects unsupported media types, unknown routes, and cross-origin requests', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const media = createResponse();
    await handler(request('models', 'PATCH', {}, 'text/plain'), media.response);
    expect(media.result()).toMatchObject({
      statusCode: 415,
      body: { code: 'UNSUPPORTED_MEDIA_TYPE' },
    });

    const unknown = createResponse();
    await handler(request('unknown', 'GET'), unknown.response);
    expect(unknown.result()).toMatchObject({ statusCode: 400, body: { code: 'INVALID_INPUT' } });

    const origin = createResponse();
    await handler(
      {
        ...request('access', 'GET'),
        headers: { origin: 'https://evil.example.com' },
      },
      origin.response,
    );
    expect(origin.result()).toMatchObject({ statusCode: 403, body: { code: 'FORBIDDEN' } });
    expect(origin.result().headers.get('x-request-id')).toBe(
      (origin.result().body as { requestId: string }).requestId,
    );
  });
});
