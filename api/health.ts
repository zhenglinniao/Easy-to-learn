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
    const configured = (names: string[]) => names.every((name) => Boolean(process.env[name]));
    const dependencies = {
      supabase: configured(['SUPABASE_URL', 'SUPABASE_ANON_KEY']) ? 'ok' : 'degraded',
      redis: configured(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) ? 'ok' : 'degraded',
      ai:
        isAiProviderEnvironmentConfigured(process.env) &&
        isTutorPromptVersionConfigured(process.env.AI_PROMPT_VERSION)
          ? 'ok'
          : 'degraded',
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
