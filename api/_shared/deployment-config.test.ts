import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface VercelConfiguration {
  crons: Array<{ path: string; schedule: string }>;
  functions: Record<string, { maxDuration: number }>;
  headers: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
}

const configuration = JSON.parse(
  readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
) as VercelConfiguration;

describe('Vercel deployment contract', () => {
  it('keeps long-running AI routes within explicit function budgets', () => {
    expect(configuration.functions['api/ai/tutor.ts']?.maxDuration).toBeGreaterThanOrEqual(60);
    expect(configuration.functions['api/ai/illustration.ts']?.maxDuration).toBeGreaterThanOrEqual(
      120,
    );
  });

  it('allows configured browser services without weakening the remaining CSP', () => {
    const globalHeaders = configuration.headers.find(({ source }) => source === '/(.*)')?.headers;
    const csp = globalHeaders?.find(({ key }) => key === 'Content-Security-Policy')?.value;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://*.supabase.co');
    expect(csp).toContain('wss://*.supabase.co');
    expect(csp).toContain('https://*.ingest.sentry.io');
    expect(csp).toContain("font-src 'self' data: blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(globalHeaders).toEqual(
      expect.arrayContaining([
        { key: 'X-DNS-Prefetch-Control', value: 'off' },
        { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        { key: 'Origin-Agent-Cluster', value: '?1' },
      ]),
    );
  });

  it('runs retention once per day', () => {
    expect(configuration.crons).toContainEqual({
      path: '/api/jobs/retention',
      schedule: '0 19 * * *',
    });
  });
});
