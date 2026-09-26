import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const RECENT_VISIT_KEY = 'easy-to-learn-recent-visit';
const DUPLICATE_WINDOW_MS = 2_000;

export function AnalyticsTracker() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (navigator.doNotTrack === '1' || typeof fetch !== 'function') return;

    const now = Date.now();
    try {
      const previous = JSON.parse(sessionStorage.getItem(RECENT_VISIT_KEY) || 'null') as {
        pathname?: string;
        timestamp?: number;
      } | null;
      if (
        previous?.pathname === pathname &&
        typeof previous.timestamp === 'number' &&
        now - previous.timestamp < DUPLICATE_WINDOW_MS
      ) {
        return;
      }
      sessionStorage.setItem(RECENT_VISIT_KEY, JSON.stringify({ pathname, timestamp: now }));
    } catch {
      // 隐私模式可能禁用 sessionStorage；统计失败不能影响页面使用。
    }

    void fetch('/api/analytics/visit', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
