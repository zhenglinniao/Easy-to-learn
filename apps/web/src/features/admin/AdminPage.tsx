import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../auth';
import { SiteHeader } from '../../pages/SiteHeader';
import {
  AdminApiClient,
  type AdminAccountView,
  type AdminOverview,
  type AdminProviderView,
} from './client';
import styles from './AdminPage.module.css';

const dateLabel = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '从未登录';

export default function AdminPage() {
  const { user, session, loading } = useAuth();
  const client = useMemo(
    () => new AdminApiClient(async () => session?.access_token ?? null),
    [session?.access_token],
  );
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [models, setModels] = useState<AdminProviderView[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmAccount, setConfirmAccount] = useState<AdminAccountView | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await client.overview(page, query, signal);
        setOverview(data);
        setModels(data.models);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : '无法打开管理员后台');
      }
    },
    [client, page, query],
  );

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, user]);

  if (loading) return <p className="route-loading">正在验证管理员身份…</p>;
  if (!user) return <Navigate to="/login?redirect=/admin" replace />;

  const updateModel = (id: string, patch: Partial<AdminProviderView>) => {
    setModels((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const moveModel = (index: number, direction: -1 | 1) => {
    setModels((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const saveModels = async () => {
    setBusy('models');
    setError(null);
    setNotice(null);
    try {
      await client.updateModels(models);
      setNotice('模型策略已保存，下一次 AI 请求开始生效。');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型策略保存失败');
    } finally {
      setBusy(null);
    }
  };
  const changeAccount = async () => {
    if (!confirmAccount) return;
    const action = confirmAccount.suspended ? 'restore' : 'suspend';
    setBusy(confirmAccount.id);
    setError(null);
    try {
      await client.updateAccount(confirmAccount.id, action);
      setNotice(action === 'suspend' ? '账户已暂停。' : '账户已恢复。');
      setConfirmAccount(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户状态更新失败');
    } finally {
      setBusy(null);
    }
  };

  const activeModels = models.filter(({ enabled }) => enabled).length;
  return (
    <main className={styles.page}>
      <SiteHeader />
      <header className={styles.heading}>
        <div>
          <p>运营控制台</p>
          <h1>管理员后台</h1>
          <span>只管理运行策略与必要账户元数据，密钥和用户内容始终不可见。</span>
        </div>
        <span className={styles.adminIdentity}>管理员 · {user.email}</span>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <dl className={styles.stats} aria-label="管理概览">
        <div>
          <dt>注册账户</dt>
          <dd>{overview?.pagination.total ?? '—'}</dd>
        </div>
        <div>
          <dt>本页暂停</dt>
          <dd>{overview?.pageSuspended ?? '—'}</dd>
        </div>
        <div>
          <dt>启用模型</dt>
          <dd>{overview ? `${activeModels}/${models.length}` : '—'}</dd>
        </div>
      </dl>

      <section className={styles.panel} aria-labelledby="models-title">
        <div className={styles.panelHeading}>
          <div>
            <p>模型调用</p>
            <h2 id="models-title">运行策略</h2>
          </div>
          <button
            type="button"
            disabled={busy === 'models' || !overview}
            onClick={() => void saveModels()}
          >
            {busy === 'models' ? '正在保存…' : '保存并生效'}
          </button>
        </div>
        <p className={styles.helper}>
          顺序代表回退优先级。API Key、服务地址和 Provider 类型只能在 Vercel 环境变量中修改。
        </p>
        <div className={styles.modelList}>
          {models.map((provider, index) => (
            <article className={styles.modelCard} key={provider.id}>
              <div className={styles.modelOrder}>
                <strong>{index + 1}</strong>
                <div>
                  <button
                    aria-label={`上移 ${provider.id}`}
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveModel(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`下移 ${provider.id}`}
                    type="button"
                    disabled={index === models.length - 1}
                    onClick={() => moveModel(index, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
              <div className={styles.modelFields}>
                <div className={styles.modelTitle}>
                  <strong>{provider.id}</strong>
                  <span>{provider.type}</span>
                </div>
                <label>
                  模型名称
                  <input
                    value={provider.model}
                    maxLength={160}
                    onChange={(event) => updateModel(provider.id, { model: event.target.value })}
                  />
                </label>
                <label>
                  超时（毫秒）
                  <input
                    type="number"
                    min={1000}
                    max={25000}
                    step={500}
                    value={provider.timeoutMs}
                    onChange={(event) =>
                      updateModel(provider.id, { timeoutMs: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={(event) => updateModel(provider.id, { enabled: event.target.checked })}
                />
                <span>{provider.enabled ? '已启用' : '已停用'}</span>
              </label>
            </article>
          ))}
          {!overview && !error && <p className={styles.loading}>正在读取模型策略…</p>}
        </div>
        {overview?.policyUpdatedAt && (
          <small>上次更新：{dateLabel(overview.policyUpdatedAt)}</small>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="accounts-title">
        <div className={styles.panelHeading}>
          <div>
            <p>账户数据</p>
            <h2 id="accounts-title">学习者账户</h2>
          </div>
          <form
            className={styles.search}
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setQuery(search);
            }}
          >
            <label>
              <span className={styles.srOnly}>搜索邮箱或用户 ID</span>
              <input
                placeholder="搜索邮箱或用户 ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button type="submit">搜索</button>
          </form>
        </div>
        <div className={styles.accountTable} role="table" aria-label="账户列表">
          <div className={styles.accountHeader} role="row">
            <span>账户</span>
            <span>状态</span>
            <span>画板</span>
            <span>最近登录</span>
            <span>操作</span>
          </div>
          {overview?.accounts.map((account) => (
            <div className={styles.accountRow} role="row" key={account.id}>
              <div>
                <strong>{account.email}</strong>
                <small>{account.id}</small>
              </div>
              <span className={account.suspended ? styles.statusSuspended : styles.statusActive}>
                {account.suspended ? '已暂停' : account.emailConfirmed ? '正常' : '待验证'}
              </span>
              <span>{account.boardCount}</span>
              <span>{dateLabel(account.lastSignInAt)}</span>
              <button
                className={account.suspended ? undefined : styles.suspendButton}
                type="button"
                disabled={busy === account.id}
                onClick={() => setConfirmAccount(account)}
              >
                {account.suspended ? '恢复' : '暂停'}
              </button>
            </div>
          ))}
          {overview?.accounts.length === 0 && (
            <p className={styles.loading}>没有符合条件的账户。</p>
          )}
        </div>
        <div className={styles.pagination}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            上一页
          </button>
          <span>第 {page} 页</span>
          <button
            type="button"
            disabled={!overview || page * overview.pagination.perPage >= overview.pagination.total}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      </section>

      {confirmAccount && (
        <div className={styles.dialogBackdrop} role="presentation">
          <div
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="account-action-title"
          >
            <h2 id="account-action-title">
              {confirmAccount.suspended ? '恢复账户？' : '暂停账户？'}
            </h2>
            <p>
              {confirmAccount.suspended
                ? '恢复后，该学习者可以重新登录并使用云端功能。'
                : '暂停后，该学习者将不能继续登录；已有会话按 Supabase 会话策略失效。用户数据不会被删除。'}
            </p>
            <code>{confirmAccount.email}</code>
            <div>
              <button type="button" onClick={() => setConfirmAccount(null)}>
                取消
              </button>
              <button
                className={!confirmAccount.suspended ? styles.dangerButton : undefined}
                type="button"
                disabled={busy === confirmAccount.id}
                onClick={() => void changeAccount()}
              >
                {confirmAccount.suspended ? '确认恢复' : '确认暂停'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
