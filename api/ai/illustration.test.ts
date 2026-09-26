import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const execute = vi.hoisted(() => vi.fn());
const createIllustrationService = vi.hoisted(() => vi.fn(async () => ({ execute })));
const resolveActor = vi.hoisted(() => vi.fn());

vi.mock('../_shared/runtime.js', () => ({ createIllustrationService, resolveActor }));

import handler from './illustration.js';

const requestId = '00000000-0000-4000-8000-000000000010';

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
  body: { requestId, boardId: 'board-1' },
  headers: {
    origin: 'https://easy.example.com',
    'content-type': 'application/json',
  },
  ...overrides,
});

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  resolveActor.mockReset().mockResolvedValue({
    actor: { kind: 'user', id: 'user-1' },
    accessToken: 'access-token',
  });
  createIllustrationService.mockClear();
  execute.mockReset().mockResolvedValue({ data: { status: 'not_applicable', quota: {} } });
});

afterEach(() => {
  delete process.env.APP_ORIGINS;
  vi.restoreAllMocks();
});

describe('/api/ai/illustration', () => {
  it('preserves the tutor request id across image generation', async () => {
    const output = createResponse();
    await handler(request(), output.response);

    expect(output.result()).toMatchObject({
      statusCode: 200,
      body: { data: { status: 'not_applicable' } },
    });
    expect(output.result().headers.get('cache-control')).toContain('no-store');
    expect(output.result().headers.get('x-request-id')).toBe(requestId);
    expect(createIllustrationService).toHaveBeenCalledWith(
      { kind: 'user', id: 'user-1' },
      'access-token',
    );
    expect(execute).toHaveBeenCalledWith(
      { kind: 'user', id: 'user-1' },
      { requestId, boardId: 'board-1' },
    );
  });

  it.each([
    ['wrong method', { method: 'GET' }, 400, 'INVALID_INPUT'],
    [
      'wrong media type',
      { headers: { origin: 'https://easy.example.com', 'content-type': 'text/plain' } },
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [
      'cross-origin request',
      { headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' } },
      403,
      'FORBIDDEN',
    ],
  ])('rejects %s before opening image dependencies', async (_name, overrides, status, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = createResponse();
    await handler(request(overrides as Partial<HttpRequest>), output.response);

    expect(output.result()).toMatchObject({ statusCode: status, body: { code } });
    expect(resolveActor).not.toHaveBeenCalled();
    expect(createIllustrationService).not.toHaveBeenCalled();
  });

  it('falls back to a safe trace id when malformed input fails early', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = createResponse();
    await handler(
      request({ method: 'GET', body: { requestId: 'bad\r\nrequest' } }),
      output.response,
    );

    const traceId = output.result().headers.get('x-request-id');
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(output.result().body).toMatchObject({ requestId: traceId, code: 'INVALID_INPUT' });
  });
});
