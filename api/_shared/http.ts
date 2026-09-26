import { randomUUID } from 'node:crypto';

import { ApiFault, asApiFault } from './fault.js';
import { logApiError } from './logger.js';

export interface HttpRequest {
  method?: string;
  url?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
}

export const header = (request: HttpRequest, name: string): string | undefined => {
  const value = request.headers[name.toLowerCase()] ?? request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export const cookieValue = (request: HttpRequest, name: string): string | undefined =>
  header(request, 'cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)
    ?.slice(1)
    .join('=');

export const requireAllowedOrigin = (request: HttpRequest): void => {
  const origin = header(request, 'origin');
  const allowed = (process.env.APP_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) return;

  // 浏览器不会保证为同源 GET/HEAD 附带 Origin。此时使用 Referer 的 origin
  // 完成同样的白名单校验；若隐私策略同时移除了 Referer，则只接受浏览器明确
  // 标记为 same-origin 的安全读取请求。所有写操作仍必须携带合法 Origin。
  const method = request.method?.toUpperCase() ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    const referer = header(request, 'referer');
    if (referer) {
      try {
        if (allowed.includes(new URL(referer).origin)) return;
      } catch {
        // 非法 Referer 继续按拒绝处理。
      }
    }
    if (!origin && header(request, 'sec-fetch-site') === 'same-origin') return;
  }

  throw new ApiFault('FORBIDDEN', '请求来源不被允许');
};

export const sendError = (response: HttpResponse, error: unknown, requestId?: string): void => {
  const fault = asApiFault(error);
  const id = requestId || randomUUID();
  logApiError(fault, id);
  response.setHeader('X-Request-Id', id);
  response.status(fault.httpStatus).json(fault.toResponse(id));
};
