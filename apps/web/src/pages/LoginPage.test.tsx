import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../features/auth';
import LoginPage from './LoginPage';

vi.mock('../features/auth/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/auth/supabase')>()),
  isSupabaseConfigured: () => true,
  isOAuthProviderEnabled: () => false,
}));

const actions = {
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendSignUpConfirmation: vi.fn(),
  updatePassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
};

const authValue = (): AuthContextValue => ({
  loading: false,
  initializationError: null,
  user: null,
  session: null,
  ...actions,
});

const renderLogin = () =>
  render(
    <AuthContext.Provider value={authValue()}>
      <MemoryRouter initialEntries={['/login?redirect=/boards']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/boards" element={<p>画板列表</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.signIn.mockResolvedValue(undefined);
    actions.signUp.mockResolvedValue({ requiresEmailConfirmation: true });
    actions.requestPasswordReset.mockResolvedValue(undefined);
    actions.resendSignUpConfirmation.mockResolvedValue(undefined);
  });

  it('校验注册确认密码与条款，并显示邮箱验证状态', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('tab', { name: '注册' }));
    await user.type(screen.getByLabelText('邮箱'), 'Learner@Example.com');
    await user.type(screen.getByLabelText(/^密码/), 'Password123!');
    await user.type(screen.getByLabelText('确认密码'), 'Password123!');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '创建账户' }));

    expect(actions.signUp).toHaveBeenCalledWith('Learner@Example.com', 'Password123!', '/boards');
    expect(screen.getByText(/验证邮件已发送/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '没收到邮件？重新发送' })).toBeInTheDocument();
  });

  it('登录成功后恢复经过白名单验证的目标页', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('邮箱'), 'learner@example.com');
    await user.type(screen.getByLabelText('密码'), 'Password123!');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(actions.signIn).toHaveBeenCalledWith('learner@example.com', 'Password123!');
    expect(await screen.findByText('画板列表')).toBeInTheDocument();
  });

  it('找回密码使用不泄露账户是否存在的统一成功文案', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: '忘记密码？' }));
    await user.type(screen.getByLabelText('邮箱'), 'unknown@example.com');
    await user.click(screen.getByRole('button', { name: '发送重置邮件' }));

    expect(actions.requestPasswordReset).toHaveBeenCalledWith('unknown@example.com');
    expect(screen.getByText(/如果该邮箱已注册/)).toBeInTheDocument();
  });
});
