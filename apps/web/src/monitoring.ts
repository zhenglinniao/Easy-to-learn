import * as Sentry from '@sentry/react';

interface MonitoringConfiguration {
  dsn?: string;
  environment: string;
}

export const sanitizeMonitoringUrl = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value, window.location.origin);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
};

export const initializeMonitoring = ({ dsn, environment }: MonitoringConfiguration): boolean => {
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      // 画板、题目、凭据和查询参数均不应进入监控事件。
      const sanitized = { ...event };
      delete sanitized.user;
      if (event.request?.url) {
        sanitized.request = { url: sanitizeMonitoringUrl(event.request.url) as string };
      } else {
        delete sanitized.request;
      }
      return sanitized;
    },
    beforeBreadcrumb(breadcrumb) {
      if (!breadcrumb.data?.url) return breadcrumb;
      return {
        ...breadcrumb,
        data: { url: sanitizeMonitoringUrl(breadcrumb.data.url) },
      };
    },
  });
  return true;
};
