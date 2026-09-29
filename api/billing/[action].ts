import { randomUUID } from 'node:crypto';

import { checkoutRequestSchema } from '@easy-to-learn/domain';

import { StripeBillingProvider } from '../_shared/billing-provider.js';
import { ApiFault } from '../_shared/fault.js';
import {
  disableResponseCaching,
  header,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { resolveAuthenticatedAccount } from '../_shared/runtime.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '订阅功能暂未开放');
  return value;
};

const provider = (origin: string): StripeBillingProvider =>
  new StripeBillingProvider(
    required('SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    required('STRIPE_SECRET_KEY'),
    { plus: required('STRIPE_PLUS_PRICE_ID'), pro: required('STRIPE_PRO_PRICE_ID') },
    origin,
  );

const actionFrom = (request: HttpRequest): string =>
  new URL(request.url ?? '/api/billing/unknown', 'http://local').pathname
    .split('/')
    .filter(Boolean)
    .at(-1) ?? '';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  disableResponseCaching(response);
  response.setHeader('X-Request-Id', requestId);
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);
    required('STRIPE_WEBHOOK_SECRET');
    const origin = header(request, 'origin');
    if (!origin) throw new ApiFault('FORBIDDEN', '请求来源不被允许');
    const account = await resolveAuthenticatedAccount(request);
    const action = actionFrom(request);
    if (action === 'checkout') {
      const parsed = checkoutRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiFault('INVALID_INPUT', '请选择有效的订阅套餐');
      const url = await provider(origin).checkout(account.userId, parsed.data.plan);
      response.status(200).json({ data: { url } });
      return;
    }
    if (action === 'portal') {
      if (
        request.body &&
        (typeof request.body !== 'object' || Object.keys(request.body).length > 0)
      ) {
        throw new ApiFault('INVALID_INPUT', '管理订阅请求不接受参数');
      }
      const url = await provider(origin).portal(account.userId);
      response.status(200).json({ data: { url } });
      return;
    }
    throw new ApiFault('INVALID_INPUT', '订阅接口不存在');
  } catch (error) {
    sendError(response, error, requestId);
  }
}
