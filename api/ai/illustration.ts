import { randomUUID } from 'node:crypto';

import { ApiFault } from '../_shared/fault.js';
import {
  header,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createIllustrationService, resolveActor } from '../_shared/runtime.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);
    if (!header(request, 'content-type')?.toLowerCase().startsWith('application/json')) {
      throw new ApiFault('UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
    }
    const { actor, accessToken } = await resolveActor(request);
    const result = await (
      await createIllustrationService(actor, accessToken)
    ).execute(actor, request.body);
    response.setHeader('X-Request-Id', requestId);
    response.status(200).json(result);
  } catch (error) {
    sendError(response, error, requestId);
  }
}
