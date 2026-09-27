import type { AuthChangeEvent, SupabaseClient } from '@supabase/supabase-js';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthProvider';
import { useAuth } from './context';

const supabaseModule = vi.hoisted(() => ({
  configured: false,
  getOptionalClient: vi.fn(),
}));

vi.mock('./supabase', () => ({
  getOptionalSupabaseClient: supabaseModule.getOptionalClient,
  isSupabaseConfigured: () => supabaseModule.configured,
}));

afterEach(() => {
  supabaseModule.configured = false;
  supabaseModule.getOptionalClient.mockReset();
});

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span>{auth.loading ? '加载中' : (auth.user?.email ?? '游客')}</span>
      {auth.initializationError && <span>{auth.initializationError}</span>}
      <button type="button" onClick={() => void auth.signIn('learner@example.com', 'password123')}>
        登录
      </button>
      <button type="button" onClick={() => void auth.signOut()}>
        退出
      </button>
      <button
        type="button"
        onClick={() => void auth.signUp(' NEW@Example.com ', 'Password123!', '/canvas')}
      >
        注册
      </button>
      <button type="button" onClick={() => void auth.requestPasswordReset(' NEW@Example.com ')}>
        找回密码
      </button>
      <button
        type="button"
        onClick={() => void auth.resendSignUpConfirmation(' NEW@Example.com ', '/canvas')}
      >
        重发邮件
      </button>
      <button type="button" onClick={() => void auth.updatePassword('NewPassword123!')}>
        更新密码
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('按需加载浏览器客户端后再恢复 Session', async () => {
    supabaseModule.configured = true;
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { email: 'lazy@example.com' } } },
          error: null,
        }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
    } as unknown as SupabaseClient;
    supabaseModule.getOptionalClient.mockResolvedValue(client);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('加载中')).toBeInTheDocument();
    expect(await screen.findByText('lazy@example.com')).toBeInTheDocument();
    expect(supabaseModule.getOptionalClient).toHaveBeenCalledOnce();
  });

  it('未配置 Supabase 时立即提供游客状态', () => {
    render(
      <AuthProvider client={null}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByText('游客')).toBeInTheDocument();
  });

  it('恢复 Session、转发登录并在退出后清空用户', async () => {
    const user = userEvent.setup();
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const unsubscribe = vi.fn();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { email: 'learner@example.com' } } },
        }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe } } }),
        signInWithPassword,
        signOut,
      },
    } as unknown as SupabaseClient;
    const view = render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('加载中')).toBeInTheDocument();
    expect(await screen.findByText('learner@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'learner@example.com',
      password: 'password123',
    });
    await user.click(screen.getByRole('button', { name: '退出' }));
    await waitFor(() => expect(screen.getByText('游客')).toBeInTheDocument());
    expect(signOut).toHaveBeenCalledOnce();

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('完成注册、找回、重发验证与更新密码的生产参数组装', async () => {
    const user = userEvent.setup();
    const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    const resend = vi.fn().mockResolvedValue({ error: null });
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
        signUp,
        resetPasswordForEmail,
        resend,
        updateUser,
      },
    } as unknown as SupabaseClient;
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('游客');

    await user.click(screen.getByRole('button', { name: '注册' }));
    await user.click(screen.getByRole('button', { name: '找回密码' }));
    await user.click(screen.getByRole('button', { name: '重发邮件' }));
    await user.click(screen.getByRole('button', { name: '更新密码' }));

    expect(signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'Password123!',
      options: { emailRedirectTo: expect.stringContaining('/auth/callback?redirect=%2Fcanvas') },
    });
    expect(resetPasswordForEmail).toHaveBeenCalledWith('new@example.com', {
      redirectTo: expect.stringContaining('flow=recovery'),
    });
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'new@example.com',
      options: { emailRedirectTo: expect.stringContaining('/auth/callback?redirect=%2Fcanvas') },
    });
    expect(updateUser).toHaveBeenCalledWith({ password: 'NewPassword123!' });
  });

  it('会话恢复失败时结束加载并显示可操作错误', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockRejectedValue(new Error('network')),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
    } as unknown as SupabaseClient;
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('无法恢复登录状态，请检查网络后重试。')).toBeInTheDocument();
    expect(screen.getByText('游客')).toBeInTheDocument();
  });

  it('较晚返回的会话恢复结果不会覆盖更新的登录事件', async () => {
    let resolveSession:
      | ((value: { data: { session: { user: { email: string } } }; error: null }) => void)
      | undefined;
    const pendingSession = new Promise<{
      data: { session: { user: { email: string } } };
      error: null;
    }>((resolve) => {
      resolveSession = resolve;
    });
    let onAuthStateChange:
      ((event: AuthChangeEvent, session: { user: { email: string } }) => void) | undefined;
    const client = {
      auth: {
        getSession: vi.fn(() => pendingSession),
        onAuthStateChange: vi.fn((callback) => {
          onAuthStateChange = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      },
    } as unknown as SupabaseClient;
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );

    onAuthStateChange?.('SIGNED_IN', { user: { email: 'new@example.com' } });
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    resolveSession?.({
      data: { session: { user: { email: 'stale@example.com' } } },
      error: null,
    });

    await waitFor(() => expect(screen.queryByText('stale@example.com')).not.toBeInTheDocument());
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
  });
});
