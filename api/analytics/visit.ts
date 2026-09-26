import { randomUUID } from 'node:crypto';

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

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const secret = process.env.ANALYTICS_HASH_SECRET || process.env.ACTOR_HASH_SECRET;
    if (!supabaseUrl || !serviceRoleKey || !secret) {
      // 访问统计不是核心业务。未启用时明确降级为 no-op，避免每次路由切换制造 503，
      // 同时不签发访客 Cookie；真实依赖故障仍由下面的 RPC 错误返回 503。
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Analytics-Status', 'disabled');
      response.status(204).end();
      return;
    }

    const existing = cookieValue(request, ANALYTICS_COOKIE);
    const visitorId = validVisitorId(existing) ? existing : createVisitorId();
    if (!validVisitorId(existing)) {
      response.setHeader('Set-Cookie', serializeAnalyticsCookie(visitorId));
    }

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.rpc('record_analytics_visit', {
      p_visitor_hash: hashVisitorId(visitorId, secret),
      p_seen_at: new Date().toISOString(),
    });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '访问统计暂时不可用');

    response.setHeader('Cache-Control', 'no-store');
    response.status(204).end();
  } catch (error) {
    sendError(response, error, requestId);
  }
}
