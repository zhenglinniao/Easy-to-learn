import { createHash, createHmac } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';

import { ApiFault } from './fault.js';
import type { TutorActor } from './tutor-service.js';

const TICKET_TTL_SECONDS = 10 * 60;

export interface UploadTicketInput {
  requestId: string;
  contentHash: string;
  mimeType: 'image/png' | 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
}

interface TicketRecord extends UploadTicketInput {
  uploadPath: string;
}

const readImageSize = (
  bytes: Buffer,
  mimeType: UploadTicketInput['mimeType'],
): { width: number; height: number } | null => {
  if (mimeType === 'image/png') {
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      return null;
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker && marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
};

export class UploadTicketService {
  constructor(
    private readonly redis: Redis,
    private readonly actorHashSecret: string,
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  async issue(
    actor: TutorActor,
    input: UploadTicketInput,
  ): Promise<{ uploadUrl: string; uploadPath: string; expiresAt: string }> {
    const actorHash = this.actorHash(actor);
    const uploadPath = `${actorHash}/${input.requestId}/${input.contentHash}`;
    const supabase = this.supabase();
    const { data, error } = await supabase.storage
      .from('ai-temp')
      .createSignedUploadUrl(uploadPath, { upsert: false });
    if (error || !data) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '临时图片上传服务不可用');
    const record: TicketRecord = { ...input, uploadPath };
    await this.redis.set(this.ticketKey(actorHash, input.requestId), record, {
      ex: TICKET_TTL_SECONDS,
    });
    return {
      uploadUrl: data.signedUrl,
      uploadPath,
      expiresAt: new Date(Date.now() + TICKET_TTL_SECONDS * 1_000).toISOString(),
    };
  }

  async resolve(
    actor: TutorActor,
    requestId: string,
    uploadPath: string,
    mimeType: 'image/png' | 'image/jpeg',
  ): Promise<string> {
    const actorHash = this.actorHash(actor);
    const record = await this.redis.get<TicketRecord>(this.ticketKey(actorHash, requestId));
    if (!record || record.uploadPath !== uploadPath || record.mimeType !== mimeType) {
      throw new ApiFault('INVALID_INPUT', '图片上传票据无效或已过期');
    }
    const { data, error } = await this.supabase().storage.from('ai-temp').download(uploadPath);
    if (error || !data) throw new ApiFault('INVALID_INPUT', '临时图片不存在');
    const bytes = Buffer.from(await data.arrayBuffer());
    const dimensions = readImageSize(bytes, record.mimeType);
    if (
      bytes.byteLength !== record.byteSize ||
      createHash('sha256').update(bytes).digest('hex') !== record.contentHash ||
      !dimensions ||
      dimensions.width !== record.width ||
      dimensions.height !== record.height
    ) {
      throw new ApiFault('INVALID_INPUT', '临时图片完整性校验失败');
    }
    return bytes.toString('base64');
  }

  private actorHash(actor: TutorActor): string {
    return createHmac('sha256', this.actorHashSecret)
      .update(`${actor.kind}:${actor.id}`)
      .digest('hex');
  }

  private ticketKey(actorHash: string, requestId: string): string {
    return `ai:upload:${actorHash}:${requestId}`;
  }

  private supabase() {
    return createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}
