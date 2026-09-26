import {
  aiFeedbackInputSchema,
  anonymousSessionResponseSchema,
  quotaResponseSchema,
  tutorResponseSchema,
  type AiFeedbackInput,
  type QuotaStatus,
  type TutorRequest,
  type TutorResponse,
} from '@easy-to-learn/domain';
import { z } from 'zod';

const uploadTicketResponseSchema = z.strictObject({
  data: z.strictObject({
    uploadUrl: z.string().url(),
    uploadPath: z.string().min(1),
    expiresAt: z.string().datetime(),
  }),
});

const digest = async (blob: Blob): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export class TutorApiClient {
  constructor(
    private readonly getAccessToken: () => Promise<string | null>,
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  async quotaStatus(signal?: AbortSignal): Promise<QuotaStatus> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      const response = await this.fetcher('/api/anonymous/session', {
        method: 'POST',
        credentials: 'same-origin',
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw await this.error(response);
      return anonymousSessionResponseSchema.parse(await response.json()).data.quota;
    }

    const response = await this.fetcher('/api/ai/quota', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await this.error(response);
    return quotaResponseSchema.parse(await response.json()).data.quota;
  }

  async execute(request: TutorRequest, signal?: AbortSignal): Promise<TutorResponse['data']> {
    const accessToken = await this.getAccessToken();
    await this.ensureActor(accessToken, signal);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const response = await this.fetcher('/api/ai/tutor', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await this.error(response);
    return tutorResponseSchema.parse(await response.json()).data;
  }

  async uploadImage(
    requestId: string,
    blob: Blob,
    signal?: AbortSignal,
  ): Promise<{ mimeType: 'image/png' | 'image/jpeg'; uploadPath: string }> {
    if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
      throw new Error('AI 选区图片仅支持 PNG 或 JPEG');
    }
    const accessToken = await this.getAccessToken();
    await this.ensureActor(accessToken, signal);
    const bitmap = await createImageBitmap(blob);
    const input = {
      requestId,
      contentHash: await digest(blob),
      mimeType: blob.type,
      byteSize: blob.size,
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close();
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const ticketResponse = await this.fetcher('/api/ai/upload-ticket', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    if (!ticketResponse.ok) throw await this.error(ticketResponse);
    const ticket = uploadTicketResponseSchema.parse(await ticketResponse.json()).data;
    const upload = await this.fetcher(ticket.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type, 'x-upsert': 'false' },
      body: blob,
      ...(signal ? { signal } : {}),
    });
    if (!upload.ok) throw new Error('选区图片上传失败，请稍后重试。');
    return { mimeType: blob.type, uploadPath: ticket.uploadPath };
  }

  async submitFeedback(input: AiFeedbackInput, signal?: AbortSignal): Promise<void> {
    const feedback = aiFeedbackInputSchema.parse(input);
    const accessToken = await this.getAccessToken();
    await this.ensureActor(accessToken, signal);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const response = await this.fetcher('/api/ai/feedback', {
      method: 'POST',
      headers,
      body: JSON.stringify(feedback),
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await this.error(response);
  }

  private async ensureActor(accessToken: string | null, signal?: AbortSignal): Promise<void> {
    if (accessToken) return;
    const session = await this.fetcher('/api/anonymous/session', {
      method: 'POST',
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    if (!session.ok) throw await this.error(session);
  }

  private async error(response: Response): Promise<Error> {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    return new Error(body?.message ?? `AI 请求失败（${body?.code ?? response.status}）`);
  }
}
