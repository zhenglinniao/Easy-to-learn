import { ApiFault } from '../_shared/fault.js';
import {
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createAiStateStore, resolveActor } from '../_shared/runtime.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    requireAllowedOrigin(request);
    const { actor } = await resolveActor(request);
    const quota = await createAiStateStore().status(`${actor.kind}:${actor.id}`, new Date());
    response.status(200).json({ data: { quota } });
  } catch (error) {
    sendError(response, error);
  }
}
