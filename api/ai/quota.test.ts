import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const status = vi.hoisted(() => vi.fn());
const createAiStateStore = vi.hoisted(() => vi.fn(() => ({ status })));
const resolveActor = vi.hoisted(() => vi.fn());

vi.mock('../_shared/runtime.js', () => ({ createAiStateStore, resolveActor }));

import handler from './quota.js';

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

const request = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'GET',
  headers: { origin: 'https://easy.example.com' },
  ...overrides,
});

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  resolveActor.mockReset().mockResolvedValue({ actor: { kind: 'user', id: 'user-1' } });
  createAiStateStore.mockClear();
  status.mockReset().mockResolvedValue({ unlimited: true });
});

afterEach(() => {
  delete process.env.APP_ORIGINS;
  vi.restoreAllMocks();
});

describe('/api/ai/quota', () => {
  it('returns the current actor quota without allowing shared caches', async () => {
    const output = createResponse();
    await handler(request(), output.response);

    expect(output.result()).toMatchObject({
      statusCode: 200,
      body: { data: { quota: { unlimited: true } } },
    });
    expect(output.result().headers.get('cache-control')).toContain('no-store');
    expect(output.result().headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(createAiStateStore).toHaveBeenCalledWith({ kind: 'user', id: 'user-1' });
    expect(status).toHaveBeenCalledWith('user:user-1', expect.any(Date));
  });

  it('accepts a same-origin referer for a safe read without an Origin header', async () => {
    const output = createResponse();
    await handler(
      request({ headers: { referer: 'https://easy.example.com/canvas' } }),
      output.response,
    );

    expect(output.result().statusCode).toBe(200);
    expect(resolveActor).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong method', { method: 'POST' }, 400, 'INVALID_INPUT'],
    ['cross-origin request', { headers: { origin: 'https://evil.example.com' } }, 403, 'FORBIDDEN'],
  ])('rejects %s before opening quota state', async (_name, overrides, expected, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = createResponse();
    await handler(request(overrides as Partial<HttpRequest>), output.response);

    expect(output.result()).toMatchObject({ statusCode: expected, body: { code } });
    expect((output.result().body as { requestId: string }).requestId).toBe(
      output.result().headers.get('x-request-id'),
    );
    expect(resolveActor).not.toHaveBeenCalled();
    expect(createAiStateStore).not.toHaveBeenCalled();
  });
});
