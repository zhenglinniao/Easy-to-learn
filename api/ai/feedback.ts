import { aiFeedbackInputSchema } from '@easy-to-learn/domain';

import { ApiFault } from '../_shared/fault.js';
import {
  header,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createAiFeedbackService, resolveActor } from '../_shared/runtime.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const parsed = aiFeedbackInputSchema.safeParse(request.body);
  const requestId = parsed.success ? parsed.data.requestId : undefined;
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);
    if (!header(request, 'content-type')?.toLowerCase().startsWith('application/json')) {
      throw new ApiFault('UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
    }
    const { actor } = await resolveActor(request);
    await createAiFeedbackService().submit(actor, request.body);
    if (requestId) response.setHeader('X-Request-Id', requestId);
    response.status(204).end();
  } catch (error) {
    sendError(response, error, requestId);
  }
}
