const ALLOWED_ROUTES = new Set(['/', '/boards', '/canvas', '/reset-password']);
const CANVAS_ROUTE = /^\/canvas\/(?:local_[A-Za-z0-9-]+|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;

export const parseSafeRedirect = (
  value: string | null | undefined,
  fallback = '/boards',
): string => {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return fallback;
  try {
    const url = new URL(value, 'https://easy-to-learn.invalid');
    if (url.origin !== 'https://easy-to-learn.invalid') return fallback;
    if (!ALLOWED_ROUTES.has(url.pathname) && !CANVAS_ROUTE.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
};
