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

    expect(await screen.findByRole('heading', { name: '管理员权限尚未生效' })).toBeInTheDocument();
    expect(screen.getByText('user-uid-to-configure')).toBeInTheDocument();
    expect(screen.getByText(/Value 只填写上面的 UUID/)).toBeInTheDocument();
  });

  it('展示非敏感模型策略和必要账户数据，并要求确认暂停', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/admin/access') {
        return new Response(JSON.stringify({ data: { isAdmin: true, userId: 'admin-user' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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
    const modelPicker = await screen.findByRole('combobox', { name: 'Model ID' });
    expect(modelPicker).toHaveValue('model-a');
    expect(screen.getByRole('option', { name: /DeepSeek V4 Pro/ })).toBeInTheDocument();
    expect(screen.getByText('le****@example.com')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('apiKey');

    fireEvent.change(modelPicker, { target: { value: 'deepseek-v4-pro' } });
    expect(modelPicker).toHaveValue('deepseek-v4-pro');
    expect(screen.getByLabelText('显示名称')).toHaveValue('DeepSeek V4 Pro');
    expect(screen.getByText(/面向更高质量复杂推理/)).toBeInTheDocument();

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

  it('SenseNova 卡片可选择独立的 U1.5 生图模型', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/admin/access') {
        return new Response(JSON.stringify({ data: { isAdmin: true, userId: 'admin-user' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          data: {
            ...overview,
            models: [
              {
                ...overview.models[0],
                id: 'sensenova',
                label: 'SenseNova 6.8 Flash Lite',
                baseUrl: 'https://token.sensenova.cn/v1',
                model: 'sensenova-6.8-flash-lite',
                responseFormat: 'prompt',
                wireApi: 'chat_completions',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetcher);

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    const imagePicker = await screen.findByRole('combobox', { name: '生图 Model ID' });
    expect(screen.getByRole('combobox', { name: 'API 模式' })).toHaveValue('chat_completions');
    expect(screen.getByRole('combobox', { name: '结构化输出' })).toHaveValue('prompt');
    expect(screen.getByRole('option', { name: 'Responses' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'JSON Schema' })).toBeDisabled();
    expect(screen.getByRole('option', { name: /SenseNova U1\.5 Lite/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /SenseNova U1\.5 Fast/ })).toBeInTheDocument();
    fireEvent.change(imagePicker, { target: { value: 'sensenova-u1.5-fast' } });
    expect(imagePicker).toHaveValue('sensenova-u1.5-fast');
    expect(screen.getByText(/U1\.5 加速版/)).toBeInTheDocument();
  });

  it('DeepSeek 切换到 Chat Completions 时同步使用 JSON Object 并保存所选模式', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/admin/access') {
        return new Response(JSON.stringify({ data: { isAdmin: true, userId: 'admin-user' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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

    const apiMode = await screen.findByRole('combobox', { name: 'API 模式' });
    const responseFormat = screen.getByRole('combobox', { name: '结构化输出' });
    fireEvent.change(apiMode, { target: { value: 'chat_completions' } });

    expect(apiMode).toHaveValue('chat_completions');
    expect(responseFormat).toHaveValue('json_object');
    expect(screen.getByText(/Chat Completions 已同时切换为 JSON Object/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存并生效' }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        '/api/admin/models',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const saveCall = fetcher.mock.calls.find(([input]) => String(input) === '/api/admin/models');
    const body = JSON.parse(String(saveCall?.[1]?.body)) as {
      providers: typeof overview.models;
    };
    expect(body.providers[0]).toMatchObject({
      wireApi: 'chat_completions',
      responseFormat: 'json_object',
    });
  });

  it('明确提示未保存草稿并允许两个 25 秒 Provider', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/admin/access') {
        return new Response(JSON.stringify({ data: { isAdmin: true, userId: 'admin-user' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          data: {
            ...overview,
            models: [
              { ...overview.models[0], id: 'deepseek', label: 'DeepSeek', timeoutMs: 25_000 },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetcher);

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('服务端配置已加载')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加商汤日日新' }));
    expect(screen.getByText('有未保存修改')).toBeInTheDocument();
    const apiKeys = screen.getAllByLabelText('API Key');
    fireEvent.change(apiKeys[1]!, { target: { value: 'secret-sensenova' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '已停用' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('启用模型超时预算：50000/50000 ms'),
    );
    expect(screen.getByRole('button', { name: '保存并生效' })).toBeEnabled();
  });
});
