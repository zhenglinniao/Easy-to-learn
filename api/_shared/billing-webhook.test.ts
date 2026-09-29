import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseStripeEvent, verifyStripeSignature } from './billing-webhook.js';

describe('Stripe webhook signature', () => {
  it('accepts a current matching v1 signature', () => {
    const now = Date.parse('2026-09-29T08:00:00.000Z');
    const timestamp = Math.floor(now / 1_000);
    const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });
    const signature = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    expect(() =>
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, 'whsec_test', now),
    ).not.toThrow();
  });

  it('rejects stale, malformed, and mismatching signatures', () => {
    const now = Date.parse('2026-09-29T08:00:00.000Z');
    expect(() => verifyStripeSignature('{}', 't=1,v1=bad', 'secret', now)).toThrow('已过期');
    expect(() =>
      verifyStripeSignature(
        '{}',
        `t=${Math.floor(now / 1_000)},v1=${'0'.repeat(64)}`,
        'secret',
        now,
      ),
    ).toThrow('无效');
  });

  it('rejects invalid JSON events', () => {
    expect(() => parseStripeEvent('{')).toThrow('不是有效 JSON');
  });
});
