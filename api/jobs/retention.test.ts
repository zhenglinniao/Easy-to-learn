import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpResponse } from '../_shared/http.js';

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface FluentQuery extends PromiseLike<QueryResult> {
  select(...args: unknown[]): FluentQuery;
  eq(...args: unknown[]): FluentQuery;
  lte(...args: unknown[]): FluentQuery;
  limit(...args: unknown[]): FluentQuery;
  update(...args: unknown[]): FluentQuery;
  upsert(...args: unknown[]): FluentQuery;
  insert(...args: unknown[]): FluentQuery;
  in(...args: unknown[]): FluentQuery;
  maybeSingle(...args: unknown[]): FluentQuery;
}

const query = (result: QueryResult): FluentQuery => {
  const value = {} as FluentQuery;
  value.select = vi.fn(() => value);
  value.eq = vi.fn(() => value);
  value.lte = vi.fn(() => value);
  value.limit = vi.fn(() => value);
  value.update = vi.fn(() => value);
  value.upsert = vi.fn(() => value);
  value.insert = vi.fn(() => value);
  value.in = vi.fn(() => value);
  value.maybeSingle = vi.fn(() => value);
  value.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return value;
};

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() =>
  vi.fn(() => ({
    from,
    rpc,
    storage: { from: vi.fn(() => ({ remove })) },
    auth: { admin: { deleteUser: vi.fn() } },
  })),
);

vi.mock('@supabase/supabase-js', () => ({ createClient }));

import handler from './retention.js';

const originalEnvironment = { ...process.env };

const response = () => {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  const value: HttpResponse = {
    status(code) {
      statusCode = code;
      return value;
    },
    setHeader(name, headerValue) {
      headers.set(name, headerValue);
    },
    json(next) {
      body = next;
    },
    end() {},
  };
  return { value, headers, statusCode: () => statusCode, body: () => body };
};

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    CRON_SECRET: 'cron-secret',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ACTOR_HASH_SECRET: 'actor-secret',
  };
  from.mockReset();
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  remove.mockReset();
  createClient.mockClear();
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('retention job', () => {
  it('rejects requests without the cron credential before opening dependencies', async () => {
    const output = response();
    await handler({ method: 'GET', headers: {} }, output.value);

    expect(output.statusCode()).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports a clean empty run with an observable request id', async () => {
    from
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }));
    const output = response();
    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(output.statusCode()).toBe(200);
    expect(output.body()).toEqual({
      data: { accountsDeleted: 0, accountFailures: 0, assetsDeleted: 0, assetFailures: 0 },
    });
    expect(output.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns a multi-status summary when storage deletion must be retried', async () => {
    from
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(
        query({
          data: [{ id: 4, object_path: 'owner/board/hash', reason: 'board_deleted', attempts: 2 }],
          error: null,
        }),
      )
      .mockReturnValueOnce(query({ data: null, error: null }));
    remove.mockResolvedValue({ data: null, error: new Error('storage unavailable') });
    const output = response();
    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(output.statusCode()).toBe(207);
    expect(output.body()).toEqual({
      data: { accountsDeleted: 0, accountFailures: 0, assetsDeleted: 0, assetFailures: 1 },
    });
  });

  it('does not report success when a cleanup queue read fails', async () => {
    from
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: null, error: new Error('database unavailable') }));
    const output = response();
    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(output.statusCode()).toBe(503);
    expect(output.body()).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
