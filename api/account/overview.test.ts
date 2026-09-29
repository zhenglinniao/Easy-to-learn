import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const summary = vi.hoisted(() => vi.fn());
const resolveAuthenticatedAccount = vi.hoisted(() => vi.fn());
const createAccountBillingService = vi.hoisted(() => vi.fn(() => ({ summary })));

vi.mock('../_shared/runtime.js', () => ({
  createAccountBillingService,
  resolveAuthenticatedAccount,
}));

import handler from './overview.js';

const response = () => {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const value: HttpResponse = {
    status(code) {
      statusCode = code;
      return value;
    },
    setHeader(name, next) {
      headers.set(name.toLowerCase(), next);
    },
    json(next) {
      body = next;
    },
    end() {},
  };
  return { value, result: () => ({ statusCode, body, headers }) };
};

beforeEach(() => {
  process.env.APP_ORIGINS = 'https://easy.example.com';
  resolveAuthenticatedAccount.mockReset().mockResolvedValue({ userId: 'user-1' });
  summary.mockReset().mockResolvedValue({ configured: false });
  createAccountBillingService.mockClear();
});

describe('/api/account/overview', () => {
  it('returns only the authenticated account summary without caching', async () => {
    const output = response();
    await handler(
      { method: 'GET', headers: { origin: 'https://easy.example.com' } } as HttpRequest,
      output.value,
    );
    expect(output.result()).toMatchObject({
      statusCode: 200,
      body: { data: { configured: false } },
    });
    expect(output.result().headers.get('cache-control')).toContain('no-store');
    expect(createAccountBillingService).toHaveBeenCalledWith('user-1');
    expect(summary).toHaveBeenCalledWith('user-1');
  });

  it('rejects writes before account dependencies are opened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = response();
    await handler(
      { method: 'POST', headers: { origin: 'https://easy.example.com' } } as HttpRequest,
      output.value,
    );
    expect(output.result()).toMatchObject({ statusCode: 400, body: { code: 'INVALID_INPUT' } });
    expect(resolveAuthenticatedAccount).not.toHaveBeenCalled();
  });
});
