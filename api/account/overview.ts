import { randomUUID } from 'node:crypto';

import { ApiFault } from '../_shared/fault.js';
import {
  disableResponseCaching,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createAccountBillingService, resolveAuthenticatedAccount } from '../_shared/runtime.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  disableResponseCaching(response);
  response.setHeader('X-Request-Id', requestId);
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    requireAllowedOrigin(request);
    const account = await resolveAuthenticatedAccount(request);
    const data = await createAccountBillingService(account.userId).summary(account.userId);
    response.status(200).json({ data });
  } catch (error) {
    sendError(response, error, requestId);
  }
}
