import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminPage from './AdminPage';

vi.mock('../auth', () => ({
  useAuth: () => ({
    loading: false,
    initializationError: null,
    user: { id: 'admin-user', email: 'admin@example.com' },
    session: { access_token: 'admin-token', user: { id: 'admin-user' } },
    signOut: vi.fn(),
  }),
}));

vi.mock('../theme', () => ({ ThemeToggle: () => <button type="button">主题</button> }));

const overview = {
  accounts: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      email: 'le****@example.com',
      createdAt: '2026-09-01T00:00:00.000Z',
      lastSignInAt: '2026-09-25T00:00:00.000Z',
      emailConfirmed: true,
      suspended: false,
      boardCount: 2,
    },
  ],
  pagination: { page: 1, perPage: 50, total: 1 },
  models: [
    {
      id: 'primary',
      label: 'Primary',
      type: 'openai-compatible',
      enabled: true,
      model: 'model-a',
      timeoutMs: 12_000,
      hasApiKey: true,
      baseUrl: 'https://api.deepseek.com',
      responseFormat: 'json_schema',
      wireApi: 'responses',
    },
  ],
  policyUpdatedAt: null,
  pageSuspended: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe('AdminPage', () => {
  it('管理员 UID 未匹配时显示当前账户 UID 和配置指引', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ data: { isAdmin: false, userId: 'user-uid-to-configure' } }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: '管理员权限尚未生效' }),
    ).toBeInTheDocument();
    expect(screen.getByText('user-uid-to-configure')).toBeInTheDocument();
    expect(screen.getByText(/Value 只填写上面的 UUID/)).toBeInTheDocument();
  });

  it('展示非敏感模型策略和必要账户数据，并要求确认暂停', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/admin/access') {
        return new Response(
          JSON.stringify({ data: { isAdmin: true, userId: 'admin-user' } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      if (url.startsWith('/api/admin/overview')) {
        return new Response(JSON.stringify({ data: overview }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetcher);

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '管理员后台' })).toBeInTheDocument();
    expect(await screen.findByDisplayValue('model-a')).toBeInTheDocument();
    expect(screen.getByText('le****@example.com')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('apiKey');

    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('用户数据不会被删除');
    fireEvent.click(screen.getByRole('button', { name: '确认暂停' }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        '/api/admin/accounts',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });
});
