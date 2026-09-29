import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const requestDeletion = vi.hoisted(() => vi.fn());
const cancelDeletion = vi.hoisted(() => vi.fn());
const resolveAuthenticatedAccount = vi.hoisted(() => vi.fn());
const createAccountDeletionService = vi.hoisted(() =>
  vi.fn(() => ({ request: requestDeletion, cancel: cancelDeletion })),
);

vi.mock('../_shared/runtime.js', () => ({
  createAccountDeletionService,
  resolveAuthenticatedAccount,
}));

import { deletionHandler as handler } from './[action].js';

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
      headers.set(name.toLowerCase(), value);
    },
    json(value) {
      body = value;
    },
    end() {
      ended = true;
    },
  };
  return { response, result: () => ({ body, ended, headers, statusCode }) };
};

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  requestDeletion.mockReset().mockResolvedValue({ executeAfter: '2026-10-04T00:00:00.000Z' });
  cancelDeletion.mockReset().mockResolvedValue(undefined);
  resolveAuthenticatedAccount.mockReset().mockResolvedValue({
    userId: '00000000-0000-4000-8000-000000000001',
    authenticatedAt: new Date('2026-09-27T00:00:00.000Z'),
  });
  createAccountDeletionService.mockClear();
});

afterEach(() => {
  delete process.env.APP_ORIGINS;
  vi.restoreAllMocks();
});

const request = (method: string, body?: unknown): HttpRequest => ({
  method,
  body,
  headers: { origin: 'https://easy.example.com' },
});

describe('/api/account/deletion', () => {
  it('creates a deletion request with a traceable non-cacheable response', async () => {
    const output = createResponse();
    await handler(request('POST', {}), output.response);

    expect(output.result()).toMatchObject({
      statusCode: 202,
      body: { data: { executeAfter: '2026-10-04T00:00:00.000Z' } },
    });
    expect(output.result().headers.get('cache-control')).toContain('no-store');
    const requestId = output.result().headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '00000000-0000-4000-8000-000000000001' }),
      requestId,
    );
  });

  it('cancels a pending request and returns no content', async () => {
    const output = createResponse();
    await handler(request('DELETE'), output.response);

    expect(output.result()).toMatchObject({ statusCode: 204, ended: true });
    expect(cancelDeletion).toHaveBeenCalledOnce();
  });

  it('rejects unexpected input before opening account dependencies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const method = createResponse();
    await handler(request('PATCH'), method.response);
    expect(method.result()).toMatchObject({ statusCode: 400, body: { code: 'INVALID_INPUT' } });

    const body = createResponse();
    await handler(request('POST', { force: true }), body.response);
    expect(body.result()).toMatchObject({ statusCode: 400, body: { code: 'INVALID_INPUT' } });
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests and preserves the same request id in error body and header', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = createResponse();
    await handler(
      { method: 'POST', body: {}, headers: { origin: 'https://evil.example.com' } },
      output.response,
    );

    expect(output.result()).toMatchObject({ statusCode: 403, body: { code: 'FORBIDDEN' } });
    expect(output.result().headers.get('x-request-id')).toBe(
      (output.result().body as { requestId: string }).requestId,
    );
    expect(resolveAuthenticatedAccount).not.toHaveBeenCalled();
  });
});
