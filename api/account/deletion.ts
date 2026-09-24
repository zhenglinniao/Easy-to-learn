import { randomUUID } from 'node:crypto';

import { ApiFault } from '../_shared/fault.js';
import {
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createAccountDeletionService, resolveAuthenticatedAccount } from '../_shared/runtime.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  try {
    if (request.method !== 'POST' && request.method !== 'DELETE')
      throw new ApiFault('INVALID_INPUT', '仅支持 POST 或 DELETE 请求');
    requireAllowedOrigin(request);
    const account = await resolveAuthenticatedAccount(request);
    const service = createAccountDeletionService();
    if (request.method === 'POST') {
      if (
        request.body &&
        (typeof request.body !== 'object' || Object.keys(request.body).length > 0)
      )
        throw new ApiFault('INVALID_INPUT', '账户删除请求不接受参数');
      const data = await service.request(account, requestId);
      response.setHeader('X-Request-Id', requestId);
      response.status(202).json({ data });
      return;
    }
    await service.cancel(account, requestId);
    response.setHeader('X-Request-Id', requestId);
    response.status(204).end();
  } catch (error) {
    sendError(response, error, requestId);
  }
}
