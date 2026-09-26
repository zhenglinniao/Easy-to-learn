import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../features/auth';
import { SiteHeader } from './SiteHeader';

const fetchMock = vi.fn();

const authValue = (signedIn = true): AuthContextValue =>
  ({
    loading: false,
    initializationError: null,
    user: signedIn ? { id: 'admin-user', email: 'admin@example.com' } : null,
    session: signedIn ? { access_token: 'admin-token' } : null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    requestPasswordReset: vi.fn(),
    resendSignUpConfirmation: vi.fn(),
    updatePassword: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
  }) as unknown as AuthContextValue;

const renderHeader = (path: string, isAdmin: boolean) => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ data: { isAdmin, userId: 'admin-user' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <AuthContext.Provider value={authValue()}>
      <MemoryRouter initialEntries={[path]}>
        <SiteHeader />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
};

describe('SiteHeader 管理员模式切换', () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('管理员登录后在普通页面显示管理配置入口', async () => {
    renderHeader('/boards', true);

    const switchLink = await screen.findByRole('link', { name: '切换到管理员配置' });
    expect(switchLink).toHaveAttribute('href', '/admin');
    expect(switchLink).toHaveTextContent('管理配置');
  });

  it('管理员配置页显示返回用户端入口', async () => {
    renderHeader('/admin', true);

    const switchLink = await screen.findByRole('link', {
      name: '退出管理员模式，返回用户端',
    });
    expect(switchLink).toHaveAttribute('href', '/boards');
    expect(switchLink).toHaveAttribute('data-active', 'true');
  });

  it('普通账户不显示管理员模式切换', async () => {
    renderHeader('/boards', false);

    expect(await screen.findByRole('link', { name: '我的画板' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '切换到管理员配置' })).not.toBeInTheDocument();
  });
});
