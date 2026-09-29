import { randomUUID } from 'node:crypto';

import {
  parseStripeEvent,
  StripeWebhookService,
  verifyStripeSignature,
} from '../_shared/billing-webhook.js';
import { ApiFault } from '../_shared/fault.js';
import { header, sendError, type HttpRequest, type HttpResponse } from '../_shared/http.js';

export const config = { api: { bodyParser: false } };

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '订阅服务配置尚未完成');
  return value;
};

const rawBody = async (request: HttpRequest): Promise<string> => {
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');
  const stream = request as HttpRequest & AsyncIterable<Uint8Array>;
  if (typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new ApiFault('INVALID_INPUT', '支付回调缺少原始请求体');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > 1_048_576) throw new ApiFault('INVALID_INPUT', '支付回调体积过大');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    const payload = await rawBody(request);
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
  } catch (error) {
    sendError(response, error, requestId);
  }
}
