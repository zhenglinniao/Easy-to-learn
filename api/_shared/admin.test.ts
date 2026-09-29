import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateUserById = vi.hoisted(() => vi.fn());
const insertAudit = vi.hoisted(() => vi.fn());
const listUsers = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const readPolicy = vi.hoisted(() => vi.fn());
const writePolicy = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() =>
  vi.fn(() => ({
    auth: { admin: { updateUserById, listUsers } },
    from,
  })),
);

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));
vi.mock('./admin-model-policy.js', () => ({
  AdminModelPolicyStore: class {
    read = readPolicy;
    write = writePolicy;
  },
  toAdminModelPolicyView: (policy: unknown) => policy,
}));

import { AdminService } from './admin.js';

const originalEnvironment = { ...process.env };
const currentAdmin = '24952781-77aa-4f2f-9383-8223825f45c4';
const secondAdmin = '11111111-1111-4111-8111-111111111111';
const learner = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    AI_CACHE_ENCRYPTION_KEY: 'encryption-key',
    ACTOR_HASH_SECRET: 'actor-secret',
    ADMIN_USER_IDS: `${currentAdmin},${secondAdmin}`,
    AI_PROVIDERS: 'primary',
    AI_PROVIDER_PRIMARY_TYPE: 'openai-compatible',
    AI_PROVIDER_PRIMARY_BASE_URL: 'https://api.deepseek.com',
    AI_PROVIDER_PRIMARY_API_KEY: 'test-provider-key',
    AI_PROVIDER_PRIMARY_MODEL: 'deepseek-flash',
    AI_PROVIDER_PRIMARY_RESPONSE_FORMAT: 'json_schema',
  };
  updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
  listUsers.mockReset().mockResolvedValue({ data: { users: [], total: 0 }, error: null });
  readPolicy.mockReset().mockResolvedValue({ providers: [], updatedAt: null, updatedBy: null });
  writePolicy.mockReset();
  insertAudit.mockReset().mockResolvedValue({ data: null, error: null });
  from.mockReset().mockImplementation((table: string) => {
    if (table === 'security_audit_events') return { insert: insertAudit };
    throw new Error(`unexpected table: ${table}`);
  });
  createClient.mockClear();
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('AdminService account controls', () => {
  it.each([
    '------------------------------------',
    '22222222-2222-2222-2222-222222222222',
    learner.slice(1),
  ])('rejects non-UUID account id %s', async (userId) => {
    await expect(
      new AdminService().updateAccount(currentAdmin, { userId, action: 'suspend' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('prevents one administrator from suspending another administrator', async () => {
    await expect(
      new AdminService().updateAccount(currentAdmin, {
        userId: secondAdmin,
        action: 'suspend',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('suspends a learner and records an audit event without storing raw user ids', async () => {
    await expect(
      new AdminService().updateAccount(currentAdmin, { userId: learner, action: 'suspend' }),
    ).resolves.toEqual({ userId: learner, suspended: true });

    expect(updateUserById).toHaveBeenCalledWith(learner, { ban_duration: '876000h' });
    expect(insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'admin_account_suspended',
        outcome: 'success',
        actor_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        target_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(JSON.stringify(insertAudit.mock.calls)).not.toContain(learner);
    expect(JSON.stringify(insertAudit.mock.calls)).not.toContain(currentAdmin);
  });

  it('restores a learner account', async () => {
    await expect(
      new AdminService().updateAccount(currentAdmin, { userId: learner, action: 'restore' }),
    ).resolves.toEqual({ userId: learner, suspended: false });

    expect(updateUserById).toHaveBeenCalledWith(learner, { ban_duration: 'none' });
    expect(insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'admin_account_restored' }),
    );
  });

  it('rejects unsupported account actions before touching authentication', async () => {
    await expect(
      new AdminService().updateAccount(currentAdmin, { userId: learner, action: 'delete' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe('AdminService overview', () => {
  const boardQuery = (data: unknown, error: unknown = null) => {
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(() => query),
      range: vi.fn(() => Promise.resolve({ data, error })),
    };
    return query;
  };
  const entitlementQuery = (data: unknown = []) => {
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(() => Promise.resolve({ data, error: null })),
    };
    return query;
  };

  it('filters the loaded page, masks email addresses, and counts boards', async () => {
    listUsers.mockResolvedValue({
      data: {
        total: 2,
        users: [
          {
            id: learner,
            email: 'learner@example.com',
            created_at: '2026-09-01T00:00:00.000Z',
            last_sign_in_at: '2026-09-26T00:00:00.000Z',
            email_confirmed_at: '2026-09-01T00:01:00.000Z',
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            email: 'other@example.com',
            created_at: '2026-09-02T00:00:00.000Z',
          },
        ],
      },
      error: null,
    });
    const boards = boardQuery([{ owner_id: learner }, { owner_id: learner }]);
    from.mockImplementation((table: string) => {
      if (table === 'boards') return boards;
      if (table === 'account_entitlements')
        return entitlementQuery([
          { user_id: learner, plan_key: 'plus', subscription_status: 'active' },
        ]);
      if (table === 'security_audit_events') return { insert: insertAudit };
      throw new Error(`unexpected table: ${table}`);
    });

    await expect(new AdminService().overview(1, 'learner')).resolves.toMatchObject({
      accounts: [
        {
          id: learner,
          email: 'le*****@example.com',
          emailConfirmed: true,
          suspended: false,
          boardCount: 2,
          plan: 'plus',
          subscriptionStatus: 'active',
        },
      ],
      pagination: {
        page: 1,
        perPage: 50,
        total: 2,
        matchingTotal: 1,
        searchTruncated: false,
      },
      pageSuspended: 0,
    });
    expect(boards.in).toHaveBeenCalledWith('owner_id', [learner]);
    expect(boards.range).toHaveBeenCalledWith(0, 999);
    expect(readPolicy).toHaveBeenCalledOnce();
  });

  it('counts every board when the database result spans multiple response pages', async () => {
    listUsers.mockResolvedValue({
      data: {
        total: 1,
        users: [
          { id: learner, email: 'learner@example.com', created_at: '2026-09-01T00:00:00.000Z' },
        ],
      },
      error: null,
    });
    const firstBatch = Array.from({ length: 1_000 }, () => ({ owner_id: learner }));
    const boards = boardQuery([]);
    boards.range
      .mockResolvedValueOnce({ data: firstBatch, error: null })
      .mockResolvedValueOnce({ data: [{ owner_id: learner }], error: null });
    from.mockImplementation((table: string) => {
      if (table === 'boards') return boards;
      if (table === 'account_entitlements') return entitlementQuery();
      if (table === 'security_audit_events') return { insert: insertAudit };
      throw new Error(`unexpected table: ${table}`);
    });

    await expect(new AdminService().overview(1, '')).resolves.toMatchObject({
      accounts: [{ id: learner, boardCount: 1_001 }],
    });
    expect(boards.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(boards.range).toHaveBeenNthCalledWith(2, 1_000, 1_999);
  });

  it('searches across authentication pages and paginates the matching accounts', async () => {
    listUsers
      .mockResolvedValueOnce({ data: { total: 201, users: [] }, error: null })
      .mockResolvedValueOnce({
        data: {
          total: 201,
          users: [
            {
              id: learner,
              email: 'learner@example.com',
              created_at: '2026-09-01T00:00:00.000Z',
            },
          ],
        },
        error: null,
      });
    const boards = boardQuery([]);
    from.mockImplementation((table: string) => {
      if (table === 'boards') return boards;
      if (table === 'account_entitlements') return entitlementQuery();
      if (table === 'security_audit_events') return { insert: insertAudit };
      throw new Error(`unexpected table: ${table}`);
    });

    await expect(new AdminService().overview(1, 'learner')).resolves.toMatchObject({
      accounts: [{ id: learner }],
      pagination: { total: 201, matchingTotal: 1, searchTruncated: false },
    });
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 200 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 200 });
  });

  it('reports account and board dependency failures explicitly', async () => {
    listUsers.mockResolvedValueOnce({ data: { users: [] }, error: new Error('auth down') });
    await expect(new AdminService().overview(1, '')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });

    listUsers.mockResolvedValueOnce({
      data: {
        users: [
          { id: learner, email: 'learner@example.com', created_at: '2026-09-01T00:00:00.000Z' },
        ],
        total: 1,
      },
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === 'boards') return boardQuery(null, new Error('database down'));
      return { insert: insertAudit };
    });
    await expect(new AdminService().overview(1, '')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});
