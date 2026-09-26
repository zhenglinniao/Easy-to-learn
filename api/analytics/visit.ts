import { createClient } from '@supabase/supabase-js';

import {
  ANALYTICS_COOKIE,
  createVisitorId,
  hashVisitorId,
  serializeAnalyticsCookie,
  validVisitorId,
} from '../_shared/analytics.js';
import { ApiFault } from '../_shared/fault.js';
import {
  cookieValue,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '统计服务配置尚未完成');
  return value;
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);

    const existing = cookieValue(request, ANALYTICS_COOKIE);
    const visitorId = validVisitorId(existing) ? existing : createVisitorId();
    if (!validVisitorId(existing)) {
      response.setHeader('Set-Cookie', serializeAnalyticsCookie(visitorId));
    }

    const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const secret = process.env.ANALYTICS_HASH_SECRET || required('ACTOR_HASH_SECRET');
    const { error } = await client.rpc('record_analytics_visit', {
      p_visitor_hash: hashVisitorId(visitorId, secret),
      p_seen_at: new Date().toISOString(),
    });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '访问统计暂时不可用');

    response.setHeader('Cache-Control', 'no-store');
    response.status(204).end();
  } catch (error) {
    sendError(response, error);
  }
}
