import { Agent, fetch as undiciFetch } from 'undici';

const dispatchers = new Map<string, Agent>();

export const senseNovaDispatcher = (requestUrl: string, timeoutMs: number): Agent => {
  const origin = new URL(requestUrl).origin;
  const connectTimeout = Math.max(10_000, Math.min(20_000, timeoutMs - 5_000));
  const key = `${origin}:${connectTimeout}:${timeoutMs}`;
  const existing = dispatchers.get(key);
  if (existing) return existing;

  const dispatcher = new Agent({
    connect: { timeout: connectTimeout },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
  });
  dispatchers.set(key, dispatcher);
  return dispatcher;
};

export const senseNovaFetch = undiciFetch;
