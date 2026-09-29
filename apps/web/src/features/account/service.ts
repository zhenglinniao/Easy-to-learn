import {
  accountDeletionResponseSchema,
  billingSummaryResponseSchema,
  billingRedirectResponseSchema,
  type AccountDeletionResponse,
  type BillingSummary,
} from '@easy-to-learn/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const pendingDeletionSchema = z.object({
  execute_after: z.string().datetime({ offset: true }),
});

export class AccountApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly status: number;

  constructor(
    message: string,
    options: { code: string; requestId: string | null; status: number },
  ) {
    super(`${message}${options.requestId ? `（追踪号：${options.requestId}）` : ''}`);
    this.name = 'AccountApiError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export class AccountService {
  constructor(
    private readonly client: SupabaseClient,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async pendingDeletion(): Promise<{ executeAfter: string } | null> {
    const { data, error } = await this.client
      .from('account_deletion_requests')
      .select('execute_after')
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const pending = pendingDeletionSchema.parse(data);
    return { executeAfter: pending.execute_after };
  }

  async overview(): Promise<BillingSummary> {
    const response = await this.authorizedFetch('/api/account/overview', { method: 'GET' });
    if (!response.ok) throw await this.responseError(response);
    return billingSummaryResponseSchema.parse(await response.json()).data;
  }

  async checkout(plan: 'plus' | 'pro'): Promise<string> {
    const response = await this.authorizedFetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (!response.ok) throw await this.responseError(response);
    return billingRedirectResponseSchema.parse(await response.json()).data.url;
  }

  async billingPortal(): Promise<string> {
    const response = await this.authorizedFetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw await this.responseError(response);
    return billingRedirectResponseSchema.parse(await response.json()).data.url;
  }

  async requestDeletion(): Promise<AccountDeletionResponse['data']> {
    const response = await this.authorizedFetch('/api/account/deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw await this.responseError(response);
    return accountDeletionResponseSchema.parse(await response.json()).data;
  }

  async cancelDeletion(): Promise<void> {
    const response = await this.authorizedFetch('/api/account/deletion', { method: 'DELETE' });
    if (!response.ok) throw await this.responseError(response);
  }

  private async authorizedFetch(input: string, init: RequestInit): Promise<Response> {
    const { data } = await this.client.auth.getSession();
    if (!data.session) throw new Error('请先登录');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
    return this.fetcher(input, { ...init, headers, credentials: 'same-origin' });
  }

  private async responseError(response: Response): Promise<Error> {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
      requestId?: string;
    } | null;
    return new AccountApiError(body?.message ?? '账户操作失败，请稍后重试', {
      code: body?.code ?? `HTTP_${response.status}`,
      requestId: body?.requestId ?? response.headers.get('X-Request-Id'),
      status: response.status,
    });
  }
}
