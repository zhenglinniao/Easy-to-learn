import { randomUUID } from 'node:crypto';

import { isAiProviderEnvironmentConfigured } from './_shared/ai-provider-config.js';
import { ApiFault } from './_shared/fault.js';
import {
  disableResponseCaching,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from './_shared/http.js';
import { isTutorPromptVersionConfigured } from './_shared/model-prompt.js';
import { API_CONTRACT_VERSION } from './_shared/version.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  disableResponseCaching(response);
  const requestId = randomUUID();
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    const configured = (names: string[]) =>
      names.every((name) => Boolean(process.env[name]?.trim()));
    const validOrigins = (process.env.APP_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .every((value) => {
        try {
          const url = new URL(value);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            url.pathname === '/' &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      });
    const hasOrigins = Boolean(process.env.APP_ORIGINS?.trim()) && validOrigins;
    const sessionKeys = process.env.ANON_SESSION_KEYS?.split(',') ?? [];
    const validSessionKeys =
      sessionKeys.length > 0 &&
      sessionKeys.every((item) => {
        const separator = item.indexOf(':');
        return (
          separator > 0 &&
          /^[A-Za-z0-9_-]{1,16}$/.test(item.slice(0, separator)) &&
          item.slice(separator + 1).length >= 32
        );
      }) &&
      new Set(sessionKeys.map((item) => item.slice(0, item.indexOf(':')))).size ===
        sessionKeys.length;
    const encryptionKey = process.env.AI_CACHE_ENCRYPTION_KEY?.trim() ?? '';
    const validEncryptionKey =
      /^[A-Za-z0-9+/]+={0,2}$/.test(encryptionKey) &&
      Buffer.from(encryptionKey, 'base64').length === 32;
    const dependencies = {
      supabase: configured(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
        ? 'ok'
        : 'degraded',
      redis: configured(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) ? 'ok' : 'degraded',
      ai:
        isAiProviderEnvironmentConfigured(process.env) &&
        isTutorPromptVersionConfigured(process.env.AI_PROMPT_VERSION) &&
        validEncryptionKey &&
        configured(['ACTOR_HASH_SECRET'])
          ? 'ok'
          : 'degraded',
      security: hasOrigins && validSessionKeys ? 'ok' : 'degraded',
    } as const;
    const status = Object.values(dependencies).every((value) => value === 'ok') ? 'ok' : 'degraded';
    response.setHeader('X-Request-Id', requestId);
    response.status(200).json({
      data: {
        status,
        version: API_CONTRACT_VERSION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
        dependencies,
      },
    });
  } catch (error) {
    sendError(response, error, requestId);
  }
}
