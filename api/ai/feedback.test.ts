import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiFault } from '../_shared/fault.js';
import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const submit = vi.hoisted(() => vi.fn());
const createAiFeedbackService = vi.hoisted(() => vi.fn(() => ({ submit })));
const resolveActor = vi.hoisted(() => vi.fn());

vi.mock('../_shared/runtime.js', () => ({ createAiFeedbackService, resolveActor }));

import handler from './feedback.js';

const requestId = '00000000-0000-4000-8000-000000000010';
const validBody = { requestId, rating: 1 as const };

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

const request = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'POST',
  body: validBody,
  headers: {
    origin: 'https://easy.example.com',
    'content-type': 'application/json',
  },
  ...overrides,
});

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  resolveActor.mockReset().mockResolvedValue({ actor: { kind: 'user', id: 'user-1' } });
  createAiFeedbackService.mockClear();
  submit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.APP_ORIGINS;
  vi.restoreAllMocks();
});

describe('/api/ai/feedback', () => {
  it('accepts feedback without exposing it to shared caches', async () => {
    const output = createResponse();
    await handler(request(), output.response);

    expect(output.result()).toMatchObject({ statusCode: 204, ended: true });
    expect(output.result().headers.get('cache-control')).toContain('no-store');
    expect(output.result().headers.get('x-request-id')).toBe(requestId);
    expect(submit).toHaveBeenCalledWith({ kind: 'user', id: 'user-1' }, validBody);
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
  ])(
    'rejects %s before opening feedback dependencies',
    async (_name, overrides, expected, code) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const output = createResponse();
      await handler(request(overrides as Partial<HttpRequest>), output.response);

      expect(output.result()).toMatchObject({ statusCode: expected, body: { code } });
      expect(resolveActor).not.toHaveBeenCalled();
      expect(createAiFeedbackService).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed feedback inside the service without losing a safe trace id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    submit.mockRejectedValueOnce(new ApiFault('INVALID_INPUT', 'invalid feedback'));
    const output = createResponse();
    await handler(request({ body: { ...validBody, rating: 0 } }), output.response);

    expect(output.result()).toMatchObject({ statusCode: 400, body: { code: 'INVALID_INPUT' } });
    expect(output.result().headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
