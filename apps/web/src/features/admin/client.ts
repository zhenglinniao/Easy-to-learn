export interface AdminProviderView {
  id: string;
  label: string;
  type: 'gemini' | 'openai-compatible';
  enabled: boolean;
  model: string;
  timeoutMs: number;
  hasApiKey: boolean;
  apiKey?: string;
  baseUrl?: string;
  responseFormat?: 'json_schema' | 'json_object' | 'prompt';
  wireApi?: 'chat_completions' | 'responses';
  reasoningEffort?: 'none' | 'low' | 'high' | 'max';
  imageModel?: 'sensenova-u1.5-lite' | 'sensenova-u1.5-fast' | undefined;
}

export interface AdminAccountView {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  suspended: boolean;
  boardCount: number;
}

export interface AdminOverview {
  accounts: AdminAccountView[];
  pagination: { page: number; perPage: number; total: number };
  models: AdminProviderView[];
  policyUpdatedAt: string | null;
  pageSuspended: number;
}

export class AdminApiClient {
  constructor(
    private readonly getAccessToken: () => Promise<string | null>,
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  async overview(page = 1, search = '', signal?: AbortSignal): Promise<AdminOverview> {
    const query = new URLSearchParams({ page: String(page) });
    if (search.trim()) query.set('search', search.trim());
    return this.request<AdminOverview>(`/api/admin/overview?${query}`, {
      method: 'GET',
      ...(signal ? { signal } : {}),
    });
  }

  async access(signal?: AbortSignal): Promise<{ isAdmin: boolean; userId: string }> {
    return this.request<{ isAdmin: boolean; userId: string }>('/api/admin/access', {
      method: 'GET',
      ...(signal ? { signal } : {}),
    });
  }

  async updateModels(providers: AdminProviderView[]): Promise<void> {
    await this.request('/api/admin/models', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers }),
    });
  }

  async updateAccount(userId: string, action: 'suspend' | 'restore'): Promise<void> {
    await this.request('/api/admin/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action }),
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    if (!token) throw new Error('请先登录管理员账户');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await this.fetcher(path, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
    const body = (await response.json().catch(() => null)) as {
      data?: T;
      message?: string;
      code?: string;
    } | null;
    if (!response.ok)
      throw new Error(body?.message ?? `管理请求失败（${body?.code ?? response.status}）`);
    if (!body?.data) throw new Error('管理服务返回了无效数据');
    return body.data;
  }
}
