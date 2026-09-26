import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TutorActor } from './tutor-service.js';

const createSignedUploadUrl = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() =>
  vi.fn(() => ({
    storage: { from: vi.fn(() => ({ createSignedUploadUrl, download })) },
    from: vi.fn(() => ({ upsert })),
  })),
);

vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { UploadTicketService, type UploadTicketInput } from './upload-ticket.js';

const actor: TutorActor = { kind: 'user', id: 'user-1' };

const png = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const inputFor = (bytes: Buffer): UploadTicketInput => ({
  requestId: 'request-1',
  contentHash: createHash('sha256').update(bytes).digest('hex'),
  mimeType: 'image/png',
  byteSize: bytes.length,
  width: 320,
  height: 180,
});

const createRedis = () => {
  const records = new Map<string, unknown>();
  return {
    records,
    redis: {
      set: vi.fn(async (key: string, value: unknown) => {
        records.set(key, value);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => records.get(key) ?? null),
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-27T04:00:00.000Z'));
  createSignedUploadUrl.mockReset().mockResolvedValue({
    data: { signedUrl: 'https://storage.example/upload?token=opaque' },
    error: null,
  });
  download.mockReset();
  upsert.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UploadTicketService', () => {
  it('schedules every temporary upload for deletion before returning its ticket', async () => {
    const bytes = png(320, 180);
    const { redis } = createRedis();
    const service = new UploadTicketService(
      redis as never,
      'actor-secret',
      'https://project.supabase.co',
      'service-role',
    );

    const result = await service.issue(actor, inputFor(bytes));

    expect(result.uploadUrl).toContain('token=opaque');
    expect(result.expiresAt).toBe('2026-09-27T04:10:00.000Z');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        object_path: result.uploadPath,
        reason: 'temp_expired',
        not_before: '2026-09-27T05:00:00.000Z',
        status: 'pending',
        attempts: 0,
      }),
      { onConflict: 'object_path' },
    );
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(Object), { ex: 600 });
  });

  it('does not return a usable ticket when cleanup scheduling fails', async () => {
    const bytes = png(320, 180);
    const { redis } = createRedis();
    upsert.mockResolvedValue({ data: null, error: new Error('database unavailable') });
    const service = new UploadTicketService(
      redis as never,
      'actor-secret',
      'https://project.supabase.co',
      'service-role',
    );

    await expect(service.issue(actor, inputFor(bytes))).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('resolves only an intact upload bound to the same actor and request', async () => {
    const bytes = png(320, 180);
    const { redis } = createRedis();
    const service = new UploadTicketService(
      redis as never,
      'actor-secret',
      'https://project.supabase.co',
      'service-role',
    );
    const issued = await service.issue(actor, inputFor(bytes));
    download.mockResolvedValue({
      data: new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
      error: null,
    });

    await expect(service.resolve(actor, 'request-1', issued.uploadPath, 'image/png')).resolves.toBe(
      bytes.toString('base64'),
    );
    await expect(
      service.resolve({ kind: 'user', id: 'user-2' }, 'request-1', issued.uploadPath, 'image/png'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects bytes whose digest or dimensions differ from the signed manifest', async () => {
    const bytes = png(320, 180);
    const { redis } = createRedis();
    const service = new UploadTicketService(
      redis as never,
      'actor-secret',
      'https://project.supabase.co',
      'service-role',
    );
    const issued = await service.issue(actor, inputFor(bytes));
    download.mockResolvedValue({
      data: new Blob([Uint8Array.from(png(640, 360))], { type: 'image/png' }),
      error: null,
    });

    await expect(
      service.resolve(actor, 'request-1', issued.uploadPath, 'image/png'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
