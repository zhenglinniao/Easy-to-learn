import { randomUUID } from 'node:crypto';

import { checkoutRequestSchema } from '@easy-to-learn/domain';

import { StripeBillingProvider } from '../_shared/billing-provider.js';
import {
  parseStripeEvent,
  StripeWebhookService,
  verifyStripeSignature,
} from '../_shared/billing-webhook.js';
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

export const config = { api: { bodyParser: false } };

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

const rawBody = async (request: HttpRequest): Promise<string> => {
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');
  const stream = request as HttpRequest & AsyncIterable<Uint8Array>;
  if (typeof stream[Symbol.asyncIterator] !== 'function') return '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > 1_048_576) throw new ApiFault('INVALID_INPUT', '请求体积过大');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const parsedBody = async (request: HttpRequest): Promise<unknown> => {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  const payload = await rawBody(request);
  if (!payload) return undefined;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new ApiFault('INVALID_INPUT', '请求体必须是有效 JSON');
  }
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  disableResponseCaching(response);
  response.setHeader('X-Request-Id', requestId);
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    const action = actionFrom(request);
    if (action === 'webhook') {
      const payload = await rawBody(request);
      if (!payload) throw new ApiFault('INVALID_INPUT', '支付回调缺少原始请求体');
      const signature = header(request, 'stripe-signature');
      if (!signature) throw new ApiFault('FORBIDDEN', '支付回调缺少签名');
      verifyStripeSignature(payload, signature, required('STRIPE_WEBHOOK_SECRET'));
      const service = new StripeWebhookService(
        required('SUPABASE_URL'),
        required('SUPABASE_SERVICE_ROLE_KEY'),
        { plus: required('STRIPE_PLUS_PRICE_ID'), pro: required('STRIPE_PRO_PRICE_ID') },
      );
      await service.process(parseStripeEvent(payload), payload);
      response.status(200).json({ received: true });
      return;
    }
    requireAllowedOrigin(request);
    required('STRIPE_WEBHOOK_SECRET');
    const origin = header(request, 'origin');
    if (!origin) throw new ApiFault('FORBIDDEN', '请求来源不被允许');
    const account = await resolveAuthenticatedAccount(request);
    if (action === 'checkout') {
      const parsed = checkoutRequestSchema.safeParse(await parsedBody(request));
      if (!parsed.success) throw new ApiFault('INVALID_INPUT', '请选择有效的订阅套餐');
      const url = await provider(origin).checkout(account.userId, parsed.data.plan);
      response.status(200).json({ data: { url } });
      return;
    }
    if (action === 'portal') {
      const body = await parsedBody(request);
      if (body && (typeof body !== 'object' || Object.keys(body).length > 0)) {
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
