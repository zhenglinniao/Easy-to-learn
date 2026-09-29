import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import {
  ANALYTICS_COOKIE,
  createVisitorId,
  hashVisitorId,
  serializeAnalyticsCookie,
  toPublicProductMetrics,
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

const actionFrom = (request: HttpRequest): string =>
  new URL(request.url ?? '/api/analytics/unknown', 'http://local').pathname
    .split('/')
    .filter(Boolean)
    .at(-1) ?? '';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '统计服务配置尚未完成');
  return value;
};

export const metricsHandler = async (
  request: HttpRequest,
  response: HttpResponse,
): Promise<void> => {
  const requestId = randomUUID();
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('X-Request-Id', requestId);
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc('get_public_product_metrics');
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '产品统计暂时不可用');
    const row = Array.isArray(data) ? data[0] : data;
    response.setHeader(
      'Cache-Control',
      'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    );
    response.status(200).json({ data: toPublicProductMetrics(row) });
  } catch (error) {
    sendError(response, error, requestId);
  }
};

export const visitHandler = async (request: HttpRequest, response: HttpResponse): Promise<void> => {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const secret = process.env.ANALYTICS_HASH_SECRET || process.env.ACTOR_HASH_SECRET;
    if (!supabaseUrl || !serviceRoleKey || !secret) {
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
    if (error) {
      console.error(
        JSON.stringify({
          event: 'analytics_visit_rpc_failed',
          dependencyCode: error.code,
        }),
      );
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '访问统计暂时不可用');
    }
    response.setHeader('Cache-Control', 'no-store');
    response.status(204).end();
  } catch (error) {
    sendError(response, error, requestId);
  }
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  const action = actionFrom(request);
  if (action === 'metrics') return metricsHandler(request, response);
  if (action === 'visit') return visitHandler(request, response);
  sendError(response, new ApiFault('INVALID_INPUT', '统计接口不存在'));
}
