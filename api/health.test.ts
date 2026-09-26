import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from './_shared/http.js';
import handler from './health.js';

const managedEnvironment = [
  'AI_PROMPT_VERSION',
  'AI_PROVIDER_PRIMARY_API_KEY',
  'AI_PROVIDER_PRIMARY_BASE_URL',
  'AI_PROVIDER_PRIMARY_MODEL',
  'AI_PROVIDER_PRIMARY_TYPE',
  'AI_PROVIDERS',
  'SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'VERCEL_GIT_COMMIT_SHA',
] as const;

const originalEnvironment = Object.fromEntries(
  managedEnvironment.map((name) => [name, process.env[name]]),
);

const responseRecorder = () => {
  let statusCode = 0;
  let body: unknown;
  const headers = new Map<string, string>();
  const response = {
    setHeader: vi.fn((name: string, value: string) => headers.set(name.toLowerCase(), value)),
    status: vi.fn((value: number) => {
      statusCode = value;
      return response;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
    }),
  } as unknown as HttpResponse;
  return { response, result: () => ({ body, headers, statusCode }) };
};

afterEach(() => {
  for (const name of managedEnvironment) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('GET /api/health', () => {
  it('reports configured dependencies without allowing stale caches', async () => {
    Object.assign(process.env, {
      AI_PROVIDERS: 'primary',
      AI_PROVIDER_PRIMARY_TYPE: 'openai-compatible',
      AI_PROVIDER_PRIMARY_MODEL: 'model-1',
      AI_PROVIDER_PRIMARY_BASE_URL: 'https://provider.example.test/v1',
      AI_PROVIDER_PRIMARY_API_KEY: 'secret',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
      UPSTASH_REDIS_REST_TOKEN: 'redis-token',
      VERCEL_GIT_COMMIT_SHA: 'abc123',
    });
    const recorder = responseRecorder();

    await handler({ method: 'GET', headers: {} } as HttpRequest, recorder.response);

    expect(recorder.result()).toMatchObject({
      statusCode: 200,
      body: {
        data: {
          status: 'ok',
          commit: 'abc123',
          dependencies: { supabase: 'ok', redis: 'ok', ai: 'ok' },
        },
      },
    });
    expect(recorder.result().headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(recorder.result().headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports each missing dependency and rejects unsupported methods', async () => {
    for (const name of managedEnvironment) delete process.env[name];
    const health = responseRecorder();
    await handler({ method: 'GET', headers: {} } as HttpRequest, health.response);
    expect(health.result()).toMatchObject({
      statusCode: 200,
      body: {
        data: {
          status: 'degraded',
          commit: 'local',
          dependencies: { supabase: 'degraded', redis: 'degraded', ai: 'degraded' },
        },
      },
    });

    const invalid = responseRecorder();
    await handler({ method: 'POST', headers: {} } as HttpRequest, invalid.response);
    expect(invalid.result()).toMatchObject({
      statusCode: 400,
      body: { code: 'INVALID_INPUT', retryable: false },
    });
  });
});
