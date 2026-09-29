import { randomUUID } from 'node:crypto';

import { ApiFault } from '../_shared/fault.js';
import {
  disableResponseCaching,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import {
  createAccountBillingService,
  createAccountDeletionService,
  resolveAuthenticatedAccount,
} from '../_shared/runtime.js';

const actionFrom = (request: HttpRequest): string =>
  new URL(request.url ?? '/api/account/unknown', 'http://local').pathname
    .split('/')
    .filter(Boolean)
    .at(-1) ?? '';

export const overviewHandler = async (
  request: HttpRequest,
  response: HttpResponse,
): Promise<void> => {
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
};

export const deletionHandler = async (
  request: HttpRequest,
  response: HttpResponse,
): Promise<void> => {
  const requestId = randomUUID();
  disableResponseCaching(response);
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
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const action = actionFrom(request);
  if (action === 'overview') return overviewHandler(request, response);
  if (action === 'deletion') return deletionHandler(request, response);
  sendError(response, new ApiFault('INVALID_INPUT', '账户接口不存在'));
}
