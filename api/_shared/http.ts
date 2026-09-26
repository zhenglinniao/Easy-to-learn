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
  if (!origin || !allowed.includes(origin)) {
    throw new ApiFault('FORBIDDEN', '请求来源不被允许');
  }
};

export const sendError = (response: HttpResponse, error: unknown, requestId?: string): void => {
  const fault = asApiFault(error);
  const id = requestId || randomUUID();
  logApiError(fault, id);
  response.setHeader('X-Request-Id', id);
  response.status(fault.httpStatus).json(fault.toResponse(id));
};
