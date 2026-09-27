import {
  aiFeedbackInputSchema,
  apiErrorResponseSchema,
  anonymousSessionResponseSchema,
  illustrationRequestSchema,
  illustrationResponseSchema,
  quotaResponseSchema,
  tutorResponseSchema,
  MAX_ASSET_BYTES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  type AiFeedbackInput,
  type ApiErrorCode,
  type IllustrationRequest,
  type IllustrationResponse,
  type QuotaStatus,
  type TutorRequest,
  type TutorResponse,
} from '@easy-to-learn/domain';
import { z } from 'zod';

const isSafeUploadUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return (
      import.meta.env.DEV &&
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
};

const uploadTicketResponseSchema = z.strictObject({
  data: z.strictObject({
    uploadUrl: z.string().url().refine(isSafeUploadUrl),
    uploadPath: z.string().min(1).max(1_024),
    expiresAt: z.string().datetime(),
  }),
});

const digest = async (blob: Blob): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export class TutorApiError extends Error {
  override readonly name = 'TutorApiError';

  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode | null,
    readonly requestId: string | null,
    readonly retryable: boolean,
    readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message);
  }
}

export const tutorErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback;
  if (error instanceof TutorApiError && error.requestId) {
    return `${error.message}（请求编号：${error.requestId}）`;
  }
  return error.message;
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
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    };
    const response = await this.fetchWithNetworkRetry(
      '/api/ai/tutor',
      init,
      signal,
      'AI 响应连接中断，请检查网络后重试。',
    );
    if (!response.ok) throw await this.error(response);
    return tutorResponseSchema.parse(await response.json()).data;
  }

  async generateIllustration(
    input: IllustrationRequest,
    signal?: AbortSignal,
  ): Promise<IllustrationResponse['data']> {
    const request = illustrationRequestSchema.parse(input);
    const accessToken = await this.getAccessToken();
    await this.ensureActor(accessToken, signal);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const response = await this.fetchWithNetworkRetry(
      '/api/ai/illustration',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        credentials: 'same-origin',
        ...(signal ? { signal } : {}),
      },
      signal,
      '插画响应连接中断，请检查网络后重试。',
    );
    if (!response.ok) throw await this.error(response);
    return illustrationResponseSchema.parse(await response.json()).data;
  }

  async uploadImage(
    requestId: string,
    blob: Blob,
    signal?: AbortSignal,
  ): Promise<{ mimeType: 'image/png' | 'image/jpeg'; uploadPath: string }> {
    if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
      throw new Error('AI 选区图片仅支持 PNG 或 JPEG');
    }
    if (blob.size === 0 || blob.size > MAX_ASSET_BYTES) {
      throw new Error('AI 选区图片大小不符合要求');
    }
    const accessToken = await this.getAccessToken();
    await this.ensureActor(accessToken, signal);
    const contentHash = await digest(blob);
    const bitmap = await createImageBitmap(blob);
    let input;
    try {
      if (
        bitmap.width <= 0 ||
        bitmap.height <= 0 ||
        bitmap.width > MAX_IMAGE_EDGE ||
        bitmap.height > MAX_IMAGE_EDGE ||
        bitmap.width * bitmap.height > MAX_IMAGE_PIXELS
      ) {
        throw new Error('AI 选区图片尺寸不符合要求');
      }
      input = {
        requestId,
        contentHash,
        mimeType: blob.type,
        byteSize: blob.size,
        width: bitmap.width,
        height: bitmap.height,
      };
    } finally {
      bitmap.close();
    }
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

  private async fetchWithNetworkRetry(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
    failureMessage = '请求连接中断，请检查网络后重试。',
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.fetcher(url, init);
      } catch (error) {
        if (signal?.aborted || !(error instanceof TypeError)) throw error;
        if (attempt === 1) {
          throw new Error(failureMessage, { cause: error });
        }
      }
    }
    throw new Error(failureMessage);
  }

  private async error(response: Response): Promise<TutorApiError> {
    const body: unknown = await response.json().catch(() => null);
    const parsed = apiErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      return new TutorApiError(
        parsed.data.message,
        response.status,
        parsed.data.code,
        parsed.data.requestId,
        parsed.data.retryable,
        parsed.data.details,
      );
    }

    const legacy =
      body && typeof body === 'object'
        ? (body as { code?: unknown; message?: unknown; requestId?: unknown })
        : null;
    const message =
      typeof legacy?.message === 'string'
        ? legacy.message
        : `AI 请求失败（${typeof legacy?.code === 'string' ? legacy.code : response.status}）`;
    const requestId =
      typeof legacy?.requestId === 'string'
        ? legacy.requestId
        : response.headers.get('X-Request-Id');
    return new TutorApiError(
      message,
      response.status,
      null,
      requestId,
      response.status === 429 || response.status >= 500,
    );
  }
}
