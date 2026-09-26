import { createClient } from '@supabase/supabase-js';

import { toPublicProductMetrics } from '../_shared/analytics.js';
import { ApiFault } from '../_shared/fault.js';
import { sendError, type HttpRequest, type HttpResponse } from '../_shared/http.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '统计服务配置尚未完成');
  return value;
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  // 这是不含个人信息的公开聚合读接口；允许本地 Vite 页面跨域读取正式数据。
  // 写入接口仍要求 APP_ORIGINS，并且本地开发不会写入生产访问量。
  response.setHeader('Access-Control-Allow-Origin', '*');
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
    sendError(response, error);
  }
}
