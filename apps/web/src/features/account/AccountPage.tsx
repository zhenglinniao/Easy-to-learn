import type { BillingSummary } from '@easy-to-learn/domain';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { SiteHeader } from '../../pages/SiteHeader';
import { useAuth } from '../auth';
import { AccountService } from './service';
import styles from './AccountPage.module.css';

const planLabel = { free: '免费版', plus: 'Plus', pro: 'Pro' } as const;
const tierLabel = { standard: '标准模型', enhanced: '增强模型', premium: '高级模型' } as const;

const bytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index]!;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
};

const usagePercent = (used: number, limit: number): number =>
  Math.min(100, Math.max(0, (used / Math.max(1, limit)) * 100));

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <div className={styles.usageItem}>
      <div>
        <span>{label}</span>
        <strong>
          {used} / {limit}
        </strong>
      </div>
      <progress max={limit} value={Math.min(used, limit)} aria-label={`${label}用量`} />
    </div>
  );
}

export default function AccountPage() {
  const { client, user, loading } = useAuth();
  const service = useMemo(() => (client ? new AccountService(client) : null), [client]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryUserId, setSummaryUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState<'plus' | 'pro' | 'portal' | null>(null);

  useEffect(() => {
    if (!service || !user) return;
    const currentUserId = user.id;
    let active = true;
    void service
      .overview()
      .then((next) => {
        if (active) {
          setSummary(next);
          setSummaryUserId(currentUserId);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setSummary(null);
          setSummaryUserId(currentUserId);
          setError(cause instanceof Error ? cause.message : '账户信息暂时无法加载');
        }
      });
    return () => {
      active = false;
    };
  }, [service, user]);

  if (loading) return <p className="route-loading">正在恢复登录状态…</p>;
  if (!user) return <Navigate to="/login?redirect=/account" replace />;
  const current = summaryUserId === user.id ? summary : null;
  const entitlement = current?.entitlement;
  const quota = current?.quota;
  const redirectToBilling = async (action: 'plus' | 'pro' | 'portal') => {
    if (!service || billingBusy) return;
    setBillingBusy(action);
    setError(null);
    try {
      const url =
        action === 'portal' ? await service.billingPortal() : await service.checkout(action);
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法打开订阅服务');
      setBillingBusy(null);
    }
  };

  return (
    <main className={styles.page}>
      <SiteHeader />
      <header className={styles.heading}>
        <p>账户中心</p>
        <h1>你的学习空间与用量</h1>
        <span>{user.email ?? '已登录账户'}</span>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {!current && !error ? <p className={styles.loading}>正在汇总账户权益与用量…</p> : null}

      {current && entitlement && quota ? (
        <>
          <section className={styles.planCard} aria-labelledby="current-plan">
            <div>
              <p>当前套餐</p>
              <h2 id="current-plan">
                {entitlement.source === 'admin_override'
                  ? '管理员权益'
                  : planLabel[entitlement.plan]}
              </h2>
              <span>{tierLabel[entitlement.modelQualityTier]}</span>
            </div>
            <div className={styles.planAction}>
              {current.configured ? (
                <button
                  type="button"
                  disabled={Boolean(billingBusy) || !current.subscription}
                  onClick={() => void redirectToBilling('portal')}
                >
                  {billingBusy === 'portal' ? '正在打开…' : '管理订阅'}
                </button>
              ) : (
                <span>订阅购买暂未开放</span>
              )}
              {current.subscription?.cancelAtPeriodEnd ? (
                <small>将在当前周期结束后取消</small>
              ) : null}
            </div>
          </section>

          {entitlement.plan === 'free' ? (
            <section className={styles.upgrades} aria-labelledby="upgrade-title">
              <div>
                <p>升级空间</p>
                <h2 id="upgrade-title">按学习强度选择额度</h2>
                <span>价格由 Stripe 结算页展示；付款成功后由签名回调发放权益。</span>
              </div>
              <article>
                <strong>Plus</strong>
                <span>每日 60 次解题 · 10 张插图 · 增强模型</span>
                <button
                  type="button"
                  disabled={!current.configured || Boolean(billingBusy)}
                  onClick={() => void redirectToBilling('plus')}
                >
                  {billingBusy === 'plus'
                    ? '正在打开…'
                    : current.configured
                      ? '选择 Plus'
                      : '暂未开放'}
                </button>
              </article>
              <article>
                <strong>Pro</strong>
                <span>每日 200 次解题 · 30 张插图 · 高级模型</span>
                <button
                  type="button"
                  disabled={!current.configured || Boolean(billingBusy)}
                  onClick={() => void redirectToBilling('pro')}
                >
                  {billingBusy === 'pro'
                    ? '正在打开…'
                    : current.configured
                      ? '选择 Pro'
                      : '暂未开放'}
                </button>
              </article>
            </section>
          ) : null}

          <section className={styles.grid} aria-label="账户用量">
            <article className={styles.card}>
              <p>AI 解题</p>
              <h2>{entitlement.unlimited ? '不限额' : `${quota.action.dailyRemaining} 次`}</h2>
              <span>今日剩余</span>
              {!entitlement.unlimited ? (
                <UsageBar
                  label="今日"
                  used={quota.action.dailyLimit - quota.action.dailyRemaining}
                  limit={quota.action.dailyLimit}
                />
              ) : null}
            </article>
            <article className={styles.card}>
              <p>AI 插图</p>
              <h2>{entitlement.unlimited ? '不限额' : `${quota.image.dailyRemaining} 张`}</h2>
              <span>今日剩余</span>
              {!entitlement.unlimited ? (
                <UsageBar
                  label="今日"
                  used={quota.image.dailyLimit - quota.image.dailyRemaining}
                  limit={quota.image.dailyLimit}
                />
              ) : null}
            </article>
            <article className={styles.card}>
              <p>云端画板</p>
              <h2>
                {current.usage.boards} / {entitlement.maxBoards}
              </h2>
              <span>已保存画板</span>
              <div className={styles.meter}>
                <i
                  style={{ width: `${usagePercent(current.usage.boards, entitlement.maxBoards)}%` }}
                />
              </div>
            </article>
            <article className={styles.card}>
              <p>图片存储</p>
              <h2>{bytes(current.usage.storageBytes)}</h2>
              <span>上限 {bytes(entitlement.maxStorageBytes)}</span>
              <div className={styles.meter}>
                <i
                  style={{
                    width: `${usagePercent(current.usage.storageBytes, entitlement.maxStorageBytes)}%`,
                  }}
                />
              </div>
            </article>
          </section>
        </>
      ) : null}

      <section className={styles.security} aria-labelledby="security-title">
        <div>
          <p>安全与数据</p>
          <h2 id="security-title">管理登录与个人数据</h2>
        </div>
        <nav aria-label="账户安全操作">
          <Link to="/reset-password">修改密码</Link>
          <Link to="/boards">管理画板与删除账户</Link>
        </nav>
      </section>
    </main>
  );
}
