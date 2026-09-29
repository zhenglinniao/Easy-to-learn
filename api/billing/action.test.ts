import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpRequest, HttpResponse } from '../_shared/http.js';

const checkout = vi.hoisted(() => vi.fn());
const portal = vi.hoisted(() => vi.fn());
const processEvent = vi.hoisted(() => vi.fn());
const resolveAuthenticatedAccount = vi.hoisted(() => vi.fn());
const verifyStripeSignature = vi.hoisted(() => vi.fn());
const parseStripeEvent = vi.hoisted(() => vi.fn());

vi.mock('../_shared/billing-provider.js', () => ({
  StripeBillingProvider: class {
    checkout = checkout;
    portal = portal;
  },
}));

vi.mock('../_shared/billing-webhook.js', () => ({
  verifyStripeSignature,
  parseStripeEvent,
  StripeWebhookService: class {
    process = processEvent;
  },
}));

vi.mock('../_shared/runtime.js', () => ({ resolveAuthenticatedAccount }));

import handler from './[action].js';

const createResponse = () => {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const response: HttpResponse = {
    status(code) {
      statusCode = code;
      return response;
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    json(value) {
      body = value;
    },
    end() {},
  };
  return { response, result: () => ({ statusCode, body, headers }) };
};

const request = (action: string, body?: unknown): HttpRequest => ({
  method: 'POST',
  url: `/api/billing/${action}`,
  body,
  headers: { origin: 'https://easy.example.com' },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ORIGINS = 'https://easy.example.com';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'stripe-secret';
  process.env.STRIPE_WEBHOOK_SECRET = 'webhook-secret';
  process.env.STRIPE_PLUS_PRICE_ID = 'price_plus';
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro';
  resolveAuthenticatedAccount.mockResolvedValue({ userId: 'user-1', isAnonymous: false });
});

describe('/api/billing/[action]', () => {
  it('creates a checkout session for a valid paid plan', async () => {
    checkout.mockResolvedValue('https://checkout.stripe.test/session');
    const target = createResponse();

    await handler(request('checkout', { plan: 'plus' }), target.response);

    expect(target.result().statusCode).toBe(200);
    expect(checkout).toHaveBeenCalledWith('user-1', 'plus');
    expect(target.result().body).toEqual({
      data: { url: 'https://checkout.stripe.test/session' },
    });
  });

  it('opens the customer portal without accepting extra parameters', async () => {
    portal.mockResolvedValue('https://billing.stripe.test/portal');
    const target = createResponse();

    await handler(request('portal', {}), target.response);

    expect(target.result().statusCode).toBe(200);
    expect(portal).toHaveBeenCalledWith('user-1');
  });

  it('verifies and processes webhook payloads before acknowledging them', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });
    const event = { id: 'evt_1' };
    parseStripeEvent.mockReturnValue(event);
    const target = createResponse();
    const webhook = request('webhook', payload);
    webhook.headers = { 'stripe-signature': 't=1,v1=signature' };

    await handler(webhook, target.response);

    expect(verifyStripeSignature).toHaveBeenCalledWith(
      payload,
      't=1,v1=signature',
      'webhook-secret',
    );
    expect(processEvent).toHaveBeenCalledWith(event, payload);
    expect(target.result().body).toEqual({ received: true });
  });

  it('rejects unknown actions and invalid methods', async () => {
    const unknown = createResponse();
    await handler(request('unknown', {}), unknown.response);
    expect(unknown.result().statusCode).toBe(400);

    const invalidMethod = createResponse();
    await handler(
      { ...request('checkout', { plan: 'plus' }), method: 'GET' },
      invalidMethod.response,
    );
    expect(invalidMethod.result().statusCode).toBe(400);
  });
});
