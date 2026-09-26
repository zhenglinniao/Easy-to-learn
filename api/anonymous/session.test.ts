import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';
import { issueAnonymousSession } from '../_shared/session.js';

const status = vi.hoisted(() => vi.fn());
const createAiStateStore = vi.hoisted(() => vi.fn(() => ({ status })));
const sessionKeysFromEnvironment = vi.hoisted(() =>
  vi.fn(() => [
    { version: 'v2', secret: 'b'.repeat(32) },
    { version: 'v1', secret: 'a'.repeat(32) },
  ]),
);

vi.mock('../_shared/runtime.js', () => ({ createAiStateStore, sessionKeysFromEnvironment }));

import handler from './session.js';

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
  method: 'POST',
  headers: { origin: 'https://easy.example.com' },
  ...overrides,
});

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  status.mockReset().mockResolvedValue({ dailyLimit: 3, remaining: 3 });
  createAiStateStore.mockClear();
  sessionKeysFromEnvironment.mockClear();
});

afterEach(() => {
  delete process.env.APP_ORIGINS;
  vi.restoreAllMocks();
});

describe('/api/anonymous/session', () => {
  it('creates a secure anonymous session and reads its quota', async () => {
    const output = createResponse();
    await handler(request(), output.response);

    expect(output.result()).toMatchObject({
      statusCode: 200,
      body: { data: { quota: { dailyLimit: 3, remaining: 3 } } },
    });
    expect(output.result().headers.get('cache-control')).toContain('no-store');
    expect(output.result().headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(output.result().headers.get('set-cookie')).toMatch(
      /^etl_anon=.*; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(status).toHaveBeenCalledWith(expect.stringMatching(/^anonymous:/), expect.any(Date));
  });

  it('reuses a valid rotated-key cookie without resetting its expiry', async () => {
    const issued = issueAnonymousSession(
      { version: 'v1', secret: 'a'.repeat(32) },
      new Date('2026-09-27T00:00:00.000Z'),
    );
    const output = createResponse();
    await handler(
      request({
        headers: { origin: 'https://easy.example.com', cookie: `etl_anon=${issued.cookieValue}` },
      }),
      output.response,
    );

    expect(output.result().statusCode).toBe(200);
    expect(output.result().headers.has('set-cookie')).toBe(false);
    expect(output.result().body).toMatchObject({ data: { expiresAt: issued.session.expiresAt } });
    expect(status).toHaveBeenCalledWith(`anonymous:${issued.session.id}`, expect.any(Date));
  });

  it('rotates an invalid cookie instead of trusting its actor id', async () => {
    const output = createResponse();
    await handler(
      request({ headers: { origin: 'https://easy.example.com', cookie: 'etl_anon=forged.value' } }),
      output.response,
    );

    expect(output.result().statusCode).toBe(200);
    expect(output.result().headers.get('set-cookie')).toContain('etl_anon=');
    expect(status).not.toHaveBeenCalledWith('anonymous:forged', expect.anything());
  });

  it.each([
    ['wrong method', { method: 'GET' }, 400, 'INVALID_INPUT'],
    ['cross-origin request', { headers: { origin: 'https://evil.example.com' } }, 403, 'FORBIDDEN'],
  ])('rejects %s before reading session keys', async (_name, overrides, expected, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = createResponse();
    await handler(request(overrides as Partial<HttpRequest>), output.response);

    expect(output.result()).toMatchObject({ statusCode: expected, body: { code } });
    expect(sessionKeysFromEnvironment).not.toHaveBeenCalled();
    expect(createAiStateStore).not.toHaveBeenCalled();
  });
});
