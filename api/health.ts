import { randomUUID } from 'node:crypto';

import { ApiFault } from './_shared/fault';
import { sendError, type HttpRequest, type HttpResponse } from './_shared/http';
import { API_CONTRACT_VERSION } from './_shared/version';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    const configured = (names: string[]) => names.every((name) => Boolean(process.env[name]));
    response.setHeader('X-Request-Id', requestId);
    response.status(200).json({
      data: {
        version: API_CONTRACT_VERSION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
        dependencies: {
          supabase: configured(['SUPABASE_URL', 'SUPABASE_ANON_KEY']) ? 'ok' : 'degraded',
          redis: configured(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'])
            ? 'ok'
            : 'degraded',
          ai: process.env.GEMINI_API_KEY ? 'ok' : 'degraded',
        },
      },
    });
  } catch (error) {
    sendError(response, error, requestId);
  }
}
