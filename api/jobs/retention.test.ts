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
const storageFrom = vi.hoisted(() => vi.fn(() => ({ remove })));
const deleteUser = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() =>
  vi.fn(() => ({
    from,
    rpc,
    storage: { from: storageFrom },
    auth: { admin: { deleteUser } },
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
  storageFrom.mockClear();
  deleteUser.mockReset().mockResolvedValue({ data: null, error: null });
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

  it.each([
    'Bearer cron-secreu',
    'Bearer cron-secret-extra',
    'bearer cron-secret',
    'Basic cron-secret',
  ])('rejects a near-match cron credential: %s', async (authorization) => {
    const output = response();
    await handler({ method: 'GET', headers: { authorization } }, output.value);

    expect(output.statusCode()).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports a clean empty run with an observable request id', async () => {
    from.mockReturnValueOnce(query({ data: [], error: null }));
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
      .mockReturnValueOnce(query({ data: null, error: null }));
    rpc.mockResolvedValueOnce({
      data: [{ id: 4, object_path: 'owner/board/hash', reason: 'board_deleted', attempts: 2 }],
      error: null,
    });
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

  it('deletes a due account and records its audit event', async () => {
    const auditQuery = query({ data: null, error: null });
    from
      .mockReturnValueOnce(query({ data: [{ user_id: 'user-1' }], error: null }))
      .mockReturnValueOnce(query({ data: { user_id: 'user-1' }, error: null }))
      .mockReturnValueOnce(auditQuery);
    const output = response();

    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(deleteUser).toHaveBeenCalledWith('user-1');
    expect(rpc).toHaveBeenNthCalledWith(1, 'enqueue_account_asset_cleanup', {
      p_user_id: 'user-1',
      p_not_before: expect.any(String),
    });
    expect(auditQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'account_deleted', outcome: 'success' }),
    );
    expect(output.statusCode()).toBe(200);
    expect(output.body()).toMatchObject({ data: { accountsDeleted: 1, accountFailures: 0 } });
  });

  it('marks a claimed account deletion as failed and continues cleanup', async () => {
    const failedUpdate = query({ data: null, error: null });
    from
      .mockReturnValueOnce(query({ data: [{ user_id: 'user-2' }], error: null }))
      .mockReturnValueOnce(query({ data: { user_id: 'user-2' }, error: null }))
      .mockReturnValueOnce(failedUpdate);
    deleteUser.mockResolvedValueOnce({ data: null, error: new Error('auth unavailable') });
    const output = response();

    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(failedUpdate.update).toHaveBeenCalledWith({ status: 'failed' });
    expect(output.statusCode()).toBe(207);
    expect(output.body()).toMatchObject({ data: { accountsDeleted: 0, accountFailures: 1 } });
    expect(rpc).toHaveBeenCalledWith('purge_expired_operational_records');
  });

  it('does not delete an account unless all of its asset cleanup jobs were queued', async () => {
    const failedUpdate = query({ data: null, error: null });
    from
      .mockReturnValueOnce(query({ data: [{ user_id: 'user-3' }], error: null }))
      .mockReturnValueOnce(query({ data: { user_id: 'user-3' }, error: null }))
      .mockReturnValueOnce(failedUpdate);
    rpc
      .mockResolvedValueOnce({ data: null, error: new Error('queue unavailable') })
      .mockResolvedValueOnce({ data: null, error: null });
    const output = response();

    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(deleteUser).not.toHaveBeenCalled();
    expect(failedUpdate.update).toHaveBeenCalledWith({ status: 'failed' });
    expect(output.statusCode()).toBe(207);
    expect(output.body()).toMatchObject({ data: { accountsDeleted: 0, accountFailures: 1 } });
  });

  it('completes successful temporary asset cleanup in the isolated bucket', async () => {
    const completedUpdate = query({ data: null, error: null });
    from.mockReturnValueOnce(query({ data: [], error: null })).mockReturnValueOnce(completedUpdate);
    rpc.mockResolvedValueOnce({
      data: [{ id: 9, object_path: 'request/generated.png', reason: 'temp_expired', attempts: 0 }],
      error: null,
    });
    remove.mockResolvedValue({ data: null, error: null });
    const output = response();

    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(storageFrom).toHaveBeenCalledWith('ai-temp');
    expect(remove).toHaveBeenCalledWith(['request/generated.png']);
    expect(completedUpdate.update).toHaveBeenCalledWith({
      status: 'completed',
      last_error_code: null,
    });
    expect(completedUpdate.eq).toHaveBeenCalledWith('status', 'running');
    expect(output.statusCode()).toBe(200);
    expect(output.body()).toMatchObject({ data: { assetsDeleted: 1, assetFailures: 0 } });
  });

  it('stops retrying an asset after the tenth failed deletion attempt', async () => {
    const failedUpdate = query({ data: null, error: null });
    from.mockReturnValueOnce(query({ data: [], error: null })).mockReturnValueOnce(failedUpdate);
    rpc.mockResolvedValueOnce({
      data: [{ id: 10, object_path: 'owner/board/hash', reason: 'board_deleted', attempts: 9 }],
      error: null,
    });
    remove.mockResolvedValue({ data: null, error: new Error('storage unavailable') });
    const output = response();

    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(failedUpdate.update).toHaveBeenCalledWith({
      attempts: 10,
      status: 'failed',
      last_error_code: 'STORAGE_DELETE_FAILED',
    });
    expect(failedUpdate.eq).toHaveBeenCalledWith('status', 'running');
    expect(output.statusCode()).toBe(207);
  });

  it('does not report success when a cleanup queue read fails', async () => {
    from.mockReturnValueOnce(query({ data: [], error: null }));
    rpc.mockResolvedValueOnce({ data: null, error: new Error('database unavailable') });
    const output = response();
    await handler(
      { method: 'GET', headers: { authorization: 'Bearer cron-secret' } },
      output.value,
    );

    expect(output.statusCode()).toBe(503);
    expect(output.body()).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(rpc).toHaveBeenCalledWith('claim_asset_cleanup_jobs', {
      p_limit: 100,
      p_now: expect.any(String),
    });
  });
});
