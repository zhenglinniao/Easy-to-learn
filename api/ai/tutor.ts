import { ApiFault } from '../_shared/fault.js';
import {
  disableResponseCaching,
  header,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createTutorService, resolveActor } from '../_shared/runtime.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId =
    request.body && typeof request.body === 'object' && 'requestId' in request.body
      ? String(request.body.requestId)
      : undefined;
  disableResponseCaching(response);
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);
    if (!header(request, 'content-type')?.toLowerCase().startsWith('application/json')) {
      throw new ApiFault('UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
    }
    const { actor, accessToken } = await resolveActor(request);
    const service = await createTutorService(actor, accessToken);
    const result = await service.execute(actor, request.body);
    const providerId = result.data.result.metadata.model.split('/', 1)[0];
    if (providerId && /^[a-z][a-z0-9_-]{0,31}$/i.test(providerId)) {
      response.setHeader('X-AI-Provider', providerId);
    }
    response.setHeader('X-Request-Id', result.data.requestId);
    response.status(200).json(result);
  } catch (error) {
    sendError(response, error, requestId);
  }
}
