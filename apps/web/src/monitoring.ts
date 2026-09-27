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

const sanitizeMonitoringStack = (stack: string | undefined): string | undefined => {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .slice(1)
    .map((line) => line.replace(/(https?:\/\/[^\s)]+?)[?#][^\s)]*/g, '$1'));
  return ['Error: Application error', ...frames].join('\n').slice(0, 12_000);
};

export const sanitizeMonitoringException = (value: unknown): Error => {
  const sanitized = new Error('Application error');
  if (value instanceof Error) {
    const stack = sanitizeMonitoringStack(value.stack);
    if (stack) sanitized.stack = stack;
  }
  return sanitized;
};

type MonitoringClient = typeof import('@sentry/react');

let monitoringClientPromise: Promise<MonitoringClient> | null = null;

export const initializeMonitoring = async ({
  dsn,
  environment,
}: MonitoringConfiguration): Promise<boolean> => {
  if (!dsn) return false;

  try {
    monitoringClientPromise ??= import('@sentry/react');
    const Sentry = await monitoringClientPromise;

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
        // 控制台参数、输入内容和请求正文可能包含题目或凭据，不进入遥测。
        if (breadcrumb.category === 'console') return null;
        const data = breadcrumb.data;
        const { message: _message, ...safeBreadcrumb } = breadcrumb;
        if (!data) return safeBreadcrumb;

        const safeData: Record<string, unknown> = {};
        for (const key of ['url', 'from', 'to'] as const) {
          if (data[key] !== undefined) safeData[key] = sanitizeMonitoringUrl(data[key]);
        }
        if (typeof data.method === 'string') safeData.method = data.method.slice(0, 12);
        if (typeof data.status_code === 'number') safeData.status_code = data.status_code;
        return {
          ...safeBreadcrumb,
          data: safeData,
        };
      },
    });
    return true;
  } catch {
    monitoringClientPromise = null;
    return false;
  }
};

export const captureMonitoringException = async (
  error: unknown,
  context?: Record<string, unknown>,
): Promise<boolean> => {
  if (!monitoringClientPromise) return false;
  try {
    const Sentry = await monitoringClientPromise;
    const componentStack =
      typeof context?.componentStack === 'string'
        ? context.componentStack.slice(0, 4_000)
        : undefined;
    Sentry.captureException(
      sanitizeMonitoringException(error),
      componentStack ? { contexts: { react: { componentStack } } } : undefined,
    );
    return true;
  } catch {
    return false;
  }
};
