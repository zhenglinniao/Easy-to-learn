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
import {
  imageModelOptionsFor,
  modelSelectionPatch,
  modelOptionsFor,
  selectedModelDescription,
} from './modelCatalog';
import styles from './AdminPage.module.css';

const MAX_PROVIDER_TIMEOUT_BUDGET_MS = 50_000;

const dateLabel = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '从未登录';

const isDeepSeekProvider = (provider: AdminProviderView): boolean =>
  provider.id === 'deepseek' || provider.baseUrl?.includes('api.deepseek.com') === true;

const isSenseNovaProvider = (provider: AdminProviderView): boolean =>
  provider.id === 'sensenova' || provider.baseUrl?.includes('sensenova.cn') === true;

const providerPresets: Record<'sensenova' | 'deepseek', AdminProviderView> = {
  sensenova: {
    id: 'sensenova',
    label: 'SenseNova 6.8 Flash Lite',
    type: 'openai-compatible',
    enabled: false,
    baseUrl: 'https://token.sensenova.cn/v1',
    model: 'sensenova-6.8-flash-lite',
    timeoutMs: 25_000,
    responseFormat: 'prompt',
    wireApi: 'chat_completions',
    hasApiKey: false,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek Flash',
    type: 'openai-compatible',
    enabled: false,
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    timeoutMs: 12_000,
    responseFormat: 'json_schema',
    wireApi: 'responses',
    reasoningEffort: 'none',
    hasApiKey: false,
  },
};

export default function AdminPage() {
  const { user, session, loading } = useAuth();
  const client = useMemo(
    () => new AdminApiClient(async () => session?.access_token ?? null),
    [session?.access_token],
  );
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [access, setAccess] = useState<{ isAdmin: boolean; userId: string } | null>(null);
  const [models, setModels] = useState<AdminProviderView[]>([]);
  const [savedModelsSnapshot, setSavedModelsSnapshot] = useState('');
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
        const permission = await client.access(signal);
        setAccess(permission);
        if (!permission.isAdmin) {
          setOverview(null);
          setModels([]);
          setSavedModelsSnapshot('');
          setError(null);
          return;
        }
        const data = await client.overview(page, query, signal);
        setOverview(data);
        setModels(data.models);
        setSavedModelsSnapshot(JSON.stringify(data.models));
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

  if (!access && !error) {
    return (
      <main className={styles.page}>
        <SiteHeader />
        <p className={styles.loading}>正在核对管理员白名单…</p>
      </main>
    );
  }

  if (access && !access.isAdmin) {
    return (
      <main className={styles.page}>
        <SiteHeader />
        <section className={styles.accessHelp} aria-labelledby="admin-access-title">
          <p>权限诊断</p>
          <h1 id="admin-access-title">管理员权限尚未生效</h1>
          <span>当前账户已经登录，但它的 Supabase User UID 不在生产管理员白名单中。</span>
          <dl>
            <div>
              <dt>当前账户</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>应填入 ADMIN_USER_IDS 的 UID</dt>
              <dd>
                <code>{access.userId}</code>
              </dd>
            </div>
          </dl>
          <ol>
            <li>打开 Vercel → easy-to-learn → Environment Variables。</li>
            <li>编辑 ADMIN_USER_IDS，Value 只填写上面的 UUID，不要包含变量名或等号。</li>
            <li>确认环境选择 Production；多个管理员用英文逗号分隔。</li>
            <li>保存后重新部署 Production，再刷新本页面。</li>
          </ol>
        </section>
      </main>
    );
  }

  const updateModel = (id: string, patch: Partial<AdminProviderView>) => {
    setNotice(null);
    setModels((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const updateWireApi = (
    provider: AdminProviderView,
    wireApi: 'chat_completions' | 'responses',
  ) => {
    if (isSenseNovaProvider(provider) && wireApi === 'responses') {
      updateModel(provider.id, { wireApi: 'chat_completions', responseFormat: 'prompt' });
      setNotice('SenseNova 文字模型使用 Chat Completions，结构化输出已设为仅提示词约束。');
      return;
    }
    const requiresJsonObject =
      isDeepSeekProvider(provider) &&
      wireApi === 'chat_completions' &&
      provider.responseFormat === 'json_schema';
    updateModel(provider.id, {
      wireApi,
      ...(requiresJsonObject ? { responseFormat: 'json_object' as const } : {}),
    });
    if (requiresJsonObject) {
      setNotice(
        'DeepSeek 的 Chat Completions 已同时切换为 JSON Object；该组合可以保存并用于接口测试。',
      );
    }
  };
  const updateResponseFormat = (
    provider: AdminProviderView,
    responseFormat: 'json_schema' | 'json_object' | 'prompt',
  ) => {
    if (isSenseNovaProvider(provider) && responseFormat === 'json_schema') {
      updateModel(provider.id, { wireApi: 'chat_completions', responseFormat: 'prompt' });
      setNotice('SenseNova 当前不使用 JSON Schema，已改为 Chat Completions 与仅提示词约束。');
      return;
    }
    const requiresResponses =
      isDeepSeekProvider(provider) &&
      responseFormat === 'json_schema' &&
      provider.wireApi === 'chat_completions';
    updateModel(provider.id, {
      responseFormat,
      ...(requiresResponses ? { wireApi: 'responses' as const } : {}),
    });
    if (requiresResponses) {
      setNotice('DeepSeek 的 JSON Schema 已同时切换为 Responses，避免保存不兼容的接口组合。');
    }
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
  const addPreset = (preset: keyof typeof providerPresets) => {
    setError(null);
    setModels((items) => {
      if (items.some(({ id }) => id === preset)) {
        setError(`${providerPresets[preset].label} 已在列表中`);
        return items;
      }
      if (items.length >= 5) {
        setError('最多可配置 5 个 Provider');
        return items;
      }
      return [...items, { ...providerPresets[preset] }];
    });
  };
  const saveModels = async () => {
    if (modelPolicyIssue) {
      setError(modelPolicyIssue);
      return;
    }
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
  const enabledProviders = models.filter(({ enabled }) => enabled);
  const activeTimeoutTotal = enabledProviders.reduce(
    (total, provider) => total + provider.timeoutMs,
    0,
  );
  const timeoutExcess = activeTimeoutTotal - MAX_PROVIDER_TIMEOUT_BUDGET_MS;
  const missingKeyProvider = models.find(
    (provider) =>
      (provider.enabled || provider.imageModel) && !provider.hasApiKey && !provider.apiKey?.trim(),
  );
  const firstProviderBudget =
    enabledProviders.length > 1
      ? MAX_PROVIDER_TIMEOUT_BUDGET_MS -
        enabledProviders.slice(1).reduce((total, provider) => total + provider.timeoutMs, 0)
      : MAX_PROVIDER_TIMEOUT_BUDGET_MS;
  const modelPolicyIssue =
    activeModels === 0
      ? '至少需要启用一个教学模型。'
      : timeoutExcess > 0
        ? `当前累计超时 ${activeTimeoutTotal} ms，超出 ${MAX_PROVIDER_TIMEOUT_BUDGET_MS} ms。可将 ${enabledProviders[0]?.label ?? '首个模型'} 调整为 ${Math.max(1_000, firstProviderBudget)} ms。`
        : missingKeyProvider
          ? `${missingKeyProvider.label} 启用前必须配置 API Key。`
          : null;
  const hasUnsavedModels = Boolean(overview) && JSON.stringify(models) !== savedModelsSnapshot;
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
          <div className={styles.modelActions}>
            <button type="button" onClick={() => addPreset('sensenova')}>
              添加商汤日日新
            </button>
            <button type="button" onClick={() => addPreset('deepseek')}>
              添加 DeepSeek
            </button>
            <button
              type="button"
              disabled={
                busy === 'models' || !overview || !hasUnsavedModels || Boolean(modelPolicyIssue)
              }
              onClick={() => void saveModels()}
            >
              {busy === 'models'
                ? '正在保存…'
                : modelPolicyIssue
                  ? '修正后保存'
                  : hasUnsavedModels
                    ? '保存并生效'
                    : '当前已生效'}
            </button>
          </div>
        </div>
        <p className={styles.helper}>
          顺序代表回退优先级。API Key 只写入服务端加密存储，页面不会回显；服务地址仅允许批准的 HTTPS
          域名。
        </p>
        <div
          className={styles.policyState}
          data-error={modelPolicyIssue ? 'true' : 'false'}
          role={modelPolicyIssue ? 'alert' : 'status'}
        >
          <strong>{hasUnsavedModels ? '有未保存修改' : '服务端配置已加载'}</strong>
          <span>
            {modelPolicyIssue ??
              `启用模型超时预算：${activeTimeoutTotal}/${MAX_PROVIDER_TIMEOUT_BUDGET_MS} ms`}
          </span>
        </div>
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
                  <strong>{provider.label}</strong>
                  <span>{provider.type}</span>
                </div>
                <label>
                  显示名称
                  <input
                    value={provider.label}
                    maxLength={60}
                    onChange={(event) => updateModel(provider.id, { label: event.target.value })}
                  />
                </label>
                <label>
                  Provider ID
                  <input value={provider.id} disabled />
                </label>
                {provider.type === 'openai-compatible' && (
                  <label>
                    Base URL
                    <input
                      value={provider.baseUrl ?? ''}
                      onChange={(event) =>
                        updateModel(provider.id, { baseUrl: event.target.value })
                      }
                    />
                  </label>
                )}
                {modelOptionsFor(provider) ? (
                  <label className={styles.modelPicker}>
                    Model ID
                    <select
                      aria-label="Model ID"
                      value={provider.model}
                      onChange={(event) =>
                        updateModel(provider.id, modelSelectionPatch(provider, event.target.value))
                      }
                    >
                      {!modelOptionsFor(provider)?.some(({ id }) => id === provider.model) && (
                        <option value={provider.model}>当前配置 · {provider.model}</option>
                      )}
                      {modelOptionsFor(provider)?.map((option) => (
                        <option value={option.id} key={option.id}>
                          {option.family} · {option.label} · {option.id}
                        </option>
                      ))}
                    </select>
                    <small>
                      {selectedModelDescription(provider) ??
                        '这是已有的自定义模型配置；切换后将使用平台已知模型。'}
                    </small>
                  </label>
                ) : (
                  <label>
                    Model ID
                    <input
                      value={provider.model}
                      maxLength={160}
                      onChange={(event) => updateModel(provider.id, { model: event.target.value })}
                    />
                  </label>
                )}
                {imageModelOptionsFor(provider) && (
                  <label className={styles.modelPicker}>
                    生图 Model ID
                    <select
                      aria-label="生图 Model ID"
                      value={provider.imageModel ?? ''}
                      onChange={(event) =>
                        updateModel(provider.id, {
                          imageModel: event.target.value
                            ? (event.target.value as AdminProviderView['imageModel'])
                            : undefined,
                        })
                      }
                    >
                      <option value="">暂不启用生图</option>
                      {imageModelOptionsFor(provider)?.map((option) => (
                        <option value={option.id} key={option.id}>
                          {option.label} · {option.id}
                        </option>
                      ))}
                    </select>
                    <small>
                      {imageModelOptionsFor(provider)?.find(({ id }) => id === provider.imageModel)
                        ?.description ?? '生图模型独立配置，不参与上方教学模型的回退顺序。'}
                    </small>
                  </label>
                )}
                {provider.type === 'openai-compatible' && (
                  <>
                    <label>
                      API 模式
                      <select
                        aria-label="API 模式"
                        value={provider.wireApi ?? 'chat_completions'}
                        onChange={(event) =>
                          updateWireApi(
                            provider,
                            event.target.value as 'chat_completions' | 'responses',
                          )
                        }
                      >
                        <option value="chat_completions">Chat Completions</option>
                        <option value="responses" disabled={isSenseNovaProvider(provider)}>
                          Responses
                        </option>
                      </select>
                      {isDeepSeekProvider(provider) && (
                        <small>
                          Chat Completions 使用 JSON Object；JSON Schema 使用 Responses。
                        </small>
                      )}
                      {isSenseNovaProvider(provider) && (
                        <small>SenseNova 文字模型使用 Chat Completions。</small>
                      )}
                    </label>
                    <label>
                      结构化输出
                      <select
                        aria-label="结构化输出"
                        value={provider.responseFormat ?? 'prompt'}
                        onChange={(event) =>
                          updateResponseFormat(
                            provider,
                            event.target.value as 'json_schema' | 'json_object' | 'prompt',
                          )
                        }
                      >
                        <option value="json_schema" disabled={isSenseNovaProvider(provider)}>
                          JSON Schema
                        </option>
                        <option value="json_object">JSON Object</option>
                        <option value="prompt">仅提示词约束</option>
                      </select>
                      {isSenseNovaProvider(provider) && (
                        <small>推荐仅提示词约束；确认模型支持时可测试 JSON Object。</small>
                      )}
                    </label>
                  </>
                )}
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
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={provider.apiKey ?? ''}
                    placeholder={provider.hasApiKey ? '已配置 · 留空保持不变' : '输入后加密保存'}
                    onChange={(event) => updateModel(provider.id, { apiKey: event.target.value })}
                  />
                </label>
              </div>
              <div className={styles.modelControls}>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) =>
                      updateModel(provider.id, { enabled: event.target.checked })
                    }
                  />
                  <span>{provider.enabled ? '已启用' : '已停用'}</span>
                </label>
                <button
                  type="button"
                  className={styles.removeButton}
                  disabled={models.length === 1}
                  onClick={() => setModels((items) => items.filter(({ id }) => id !== provider.id))}
                >
                  移除
                </button>
              </div>
            </article>
          ))}
          {!overview && !error && <p className={styles.loading}>正在读取模型策略…</p>}
        </div>
        {overview?.policyUpdatedAt && (
          <small>上次更新：{dateLabel(overview.policyUpdatedAt)}</small>
        )}
        <aside className={styles.imageModelNote}>
          <strong>调用关系</strong>
          <span>教学模型按卡片顺序回退；生图模型独立执行，不占用文字模型的回退位置。</span>
        </aside>
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
