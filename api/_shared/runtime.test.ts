import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiFault } from './fault.js';
import { issueAnonymousSession } from './session.js';

const getUser = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser } })),
}));

import {
  resolveActor,
  resolveAuthenticatedAccount,
  sessionKeysFromEnvironment,
} from './runtime.js';

const originalEnvironment = { ...process.env };
const request = (authorization?: string, cookie?: string) => ({
  headers: {
    ...(authorization ? { authorization } : {}),
    ...(cookie ? { cookie } : {}),
  },
});
const jwt = (payload: object): string =>
  ['header', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join('.');

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    ANON_SESSION_KEYS: `v2:${'b'.repeat(32)},v1:${'a'.repeat(32)}`,
  };
  getUser.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('runtime authentication', () => {
  it('loads rotated anonymous keys and resolves a signed guest session', async () => {
    const keys = sessionKeysFromEnvironment();
    const issued = issueAnonymousSession(keys[1]!);

    await expect(
      resolveActor(request(undefined, `other=x; etl_anon=${issued.cookieValue}`)),
    ).resolves.toEqual({ actor: { kind: 'anonymous', id: issued.session.id } });
  });

  it('rejects malformed anonymous key configuration', () => {
    process.env.ANON_SESSION_KEYS = 'missing-separator';
    expect(sessionKeysFromEnvironment).toThrow('格式错误');
    process.env.ANON_SESSION_KEYS = 'v1:short';
    expect(sessionKeysFromEnvironment).toThrow('至少需要 32');
    process.env.ANON_SESSION_KEYS = `version!bad:${'a'.repeat(32)}`;
    expect(sessionKeysFromEnvironment).toThrow('版本格式错误');
    process.env.ANON_SESSION_KEYS = `v1:${'a'.repeat(32)},v1:${'b'.repeat(32)}`;
    expect(sessionKeysFromEnvironment).toThrow('版本不能重复');
  });

  it('accepts a case-insensitive Bearer scheme and resolves a verified user', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await expect(resolveActor(request('bearer access-token'))).resolves.toEqual({
      actor: { kind: 'user', id: 'user-1' },
      accessToken: 'access-token',
    });
  });

  it.each(['Basic token', 'Bearer ', 'Bearer one two'])(
    'rejects malformed authorization value %s',
    async (authorization) => {
      await expect(resolveActor(request(authorization))).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      } satisfies Partial<ApiFault>);
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it('rejects an oversized authorization header before contacting Supabase', async () => {
    await expect(resolveActor(request(`Bearer ${'x'.repeat(8_193)}`))).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects a token that Supabase no longer recognizes', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') });
    await expect(resolveActor(request('Bearer expired-token'))).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('extracts recent authentication time only after Supabase verifies the JWT', async () => {
    const authenticatedAt = 1_790_000_000;
    const token = jwt({ sub: 'user-1', auth_time: authenticatedAt });
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await expect(resolveAuthenticatedAccount(request(`Bearer ${token}`))).resolves.toEqual({
      userId: 'user-1',
      authenticatedAt: new Date(authenticatedAt * 1_000),
    });
  });

  it.each(['opaque-token', jwt({ sub: 'user-1' }), 'header.not-json.signature'])(
    'maps an invalid verified token payload to an authentication fault',
    async (token) => {
      getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      await expect(resolveAuthenticatedAccount(request(`Bearer ${token}`))).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      });
    },
  );
});
