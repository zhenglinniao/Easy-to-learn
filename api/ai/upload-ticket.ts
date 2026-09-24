import {
  MAX_ASSET_BYTES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  sha256Schema,
} from '@easy-to-learn/domain';
import { z } from 'zod';

import { ApiFault } from '../_shared/fault.js';
import {
  header,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createUploadTicketService, resolveActor } from '../_shared/runtime.js';

const inputSchema = z
  .strictObject({
    requestId: z.string().min(1).max(200),
    contentHash: sha256Schema,
    mimeType: z.enum(['image/png', 'image/jpeg']),
    byteSize: z.number().int().positive().max(MAX_ASSET_BYTES),
    width: z.number().int().positive().max(MAX_IMAGE_EDGE),
    height: z.number().int().positive().max(MAX_IMAGE_EDGE),
  })
  .refine(({ width, height }) => width * height <= MAX_IMAGE_PIXELS, {
    message: '图片总像素不能超过 32 MP',
  });

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId =
    request.body && typeof request.body === 'object' && 'requestId' in request.body
      ? String(request.body.requestId)
      : undefined;
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);
    if (!header(request, 'content-type')?.toLowerCase().startsWith('application/json')) {
      throw new ApiFault('UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
    }
    const input = inputSchema.safeParse(request.body);
    if (!input.success) throw new ApiFault('INVALID_INPUT', '上传票据参数不正确');
    const { actor } = await resolveActor(request);
    const data = await createUploadTicketService().issue(actor, input.data);
    response.setHeader('X-Request-Id', input.data.requestId);
    response.status(200).json({ data });
  } catch (error) {
    sendError(response, error, requestId);
  }
}
