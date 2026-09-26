import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const issue = vi.hoisted(() => vi.fn());
const createUploadTicketService = vi.hoisted(() => vi.fn(() => ({ issue })));
const resolveActor = vi.hoisted(() => vi.fn());

vi.mock('../_shared/runtime.js', () => ({ createUploadTicketService, resolveActor }));

import handler from './upload-ticket.js';

const requestId = 'upload-request-1';
const validBody = {
  requestId,
  contentHash: 'a'.repeat(64),
  mimeType: 'image/png',
  byteSize: 1024,
  width: 800,
  height: 600,
};

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
  body: validBody,
  headers: {
    origin: 'https://easy.example.com',
    'content-type': 'application/json; charset=utf-8',
  },
  ...overrides,
});

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  resolveActor.mockReset().mockResolvedValue({ actor: { kind: 'user', id: 'user-1' } });
  createUploadTicketService.mockClear();
  issue.mockReset().mockResolvedValue({ uploadUrl: 'https://storage.example.test/upload' });
});

afterEach(() => {
  delete process.env.APP_ORIGINS;
  vi.restoreAllMocks();
});

describe('/api/ai/upload-ticket', () => {
  it('issues a traceable non-cacheable upload ticket for bounded image metadata', async () => {
    const output = createResponse();
    await handler(request(), output.response);

    expect(output.result()).toMatchObject({
      statusCode: 200,
      body: { data: { uploadUrl: 'https://storage.example.test/upload' } },
    });
    expect(output.result().headers.get('cache-control')).toContain('no-store');
    expect(output.result().headers.get('x-request-id')).toBe(requestId);
    expect(issue).toHaveBeenCalledWith({ kind: 'user', id: 'user-1' }, validBody);
  });

  it.each([
    ['unsafe request id', { ...validBody, requestId: 'bad\r\nheader' }],
    ['unknown property', { ...validBody, extra: true }],
    ['excessive pixels', { ...validBody, width: 8192, height: 8192 }],
    ['zero byte image', { ...validBody, byteSize: 0 }],
  ])('rejects %s before authentication or storage access', async (_name, body) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = createResponse();
    await handler(request({ body }), output.response);

    expect(output.result()).toMatchObject({ statusCode: 400, body: { code: 'INVALID_INPUT' } });
    if (body.requestId === 'bad\r\nheader') {
      expect(output.result().headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    } else {
      expect(output.result().headers.get('x-request-id')).toBe(requestId);
    }
    expect(resolveActor).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
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
  ])('rejects %s before opening dependencies', async (_name, overrides, expected, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = createResponse();
    await handler(request(overrides as Partial<HttpRequest>), output.response);

    expect(output.result()).toMatchObject({ statusCode: expected, body: { code } });
    expect(resolveActor).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });
});
