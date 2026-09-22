import type { SupabaseClient } from '@supabase/supabase-js';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthProvider';
import { useAuth } from './context';

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span>{auth.loading ? '加载中' : (auth.user?.email ?? '游客')}</span>
      <button type="button" onClick={() => void auth.signIn('learner@example.com', 'password123')}>
        登录
      </button>
      <button type="button" onClick={() => void auth.signOut()}>
        退出
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
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
});
