import { useEffect, useState } from 'react';

import styles from '../../pages/pages.module.css';
import { formatMetricValue } from './metric-format';

interface ProductMetricsData {
  totalVisits: number;
  visitors30d: number;
  registeredUsers: number;
  generatedAt: string;
}

const metricItems = [
  ['totalVisits', '累计访问', '按 30 分钟会话合并'],
  ['visitors30d', '近 30 天访客', '匿名去重浏览器'],
  ['registeredUsers', '注册学习者', '当前有效账户'],
] as const;

const metricsEndpoint = import.meta.env.DEV
  ? 'https://easy-to-learn-steel.vercel.app/api/analytics/metrics'
  : '/api/analytics/metrics';

export function ProductMetrics() {
  const [metrics, setMetrics] = useState<ProductMetricsData | null>(null);
  const [unavailable, setUnavailable] = useState(() => typeof fetch !== 'function');

  useEffect(() => {
    if (typeof fetch !== 'function') return undefined;
    const controller = new AbortController();
    void fetch(metricsEndpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('metrics unavailable');
        const result = (await response.json()) as { data: ProductMetricsData };
        setMetrics(result.data);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setUnavailable(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <section className={styles.metricsSection} aria-labelledby="metrics-title">
      <div className={styles.metricsHeading}>
        <div>
          <p className={styles.eyebrow}>正在发生</p>
          <h2 id="metrics-title">每一次打开，都是一次新的思考。</h2>
        </div>
        <p>只展示匿名聚合数据，不记录题目、画布内容、邮箱、IP 或完整设备信息。</p>
      </div>
      <dl className={styles.metricsGrid} aria-busy={!metrics && !unavailable}>
        {metricItems.map(([key, label, description]) => (
          <div key={key} className={styles.metricCard}>
            <dt>{label}</dt>
            <dd className={!metrics && !unavailable ? styles.metricLoading : undefined}>
              {metrics ? formatMetricValue(metrics[key]) : unavailable ? '暂未连接' : '—'}
            </dd>
            <small>{description}</small>
          </div>
        ))}
      </dl>
    </section>
  );
}
