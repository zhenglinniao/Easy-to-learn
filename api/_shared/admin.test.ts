import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateUserById = vi.hoisted(() => vi.fn());
const insertAudit = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() =>
  vi.fn(() => ({
    auth: { admin: { updateUserById } },
    from: vi.fn(() => ({ insert: insertAudit })),
  })),
);

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn(() => ({})) } }));

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
  };
  updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
  insertAudit.mockReset().mockResolvedValue({ data: null, error: null });
  createClient.mockClear();
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('AdminService account controls', () => {
  it.each(['------------------------------------', '22222222-2222-2222-2222-222222222222', learner.slice(1)])(
    'rejects non-UUID account id %s',
    async (userId) => {
      await expect(
        new AdminService().updateAccount(currentAdmin, { userId, action: 'suspend' }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(updateUserById).not.toHaveBeenCalled();
    },
  );

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
});
