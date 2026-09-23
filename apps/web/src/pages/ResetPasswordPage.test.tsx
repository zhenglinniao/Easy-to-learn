import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../features/auth';
import ResetPasswordPage from './ResetPasswordPage';

const value = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
  loading: false,
  initializationError: null,
  user: { id: 'user-1', email: 'learner@example.com' } as AuthContextValue['user'],
  session: null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendSignUpConfirmation: vi.fn(),
  updatePassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  ...overrides,
});

describe('ResetPasswordPage', () => {
  it('更新密码后注销恢复会话并回到登录页', async () => {
    const user = userEvent.setup();
    const updatePassword = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthContext.Provider value={value({ updatePassword, signOut })}>
        <MemoryRouter initialEntries={['/reset-password']}>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/login" element={<p>重新登录</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await user.type(screen.getByLabelText('新密码'), 'NewPassword123!');
    await user.type(screen.getByLabelText('确认新密码'), 'NewPassword123!');
    await user.click(screen.getByRole('button', { name: '更新密码' }));

    expect(updatePassword).toHaveBeenCalledWith('NewPassword123!');
    expect(signOut).toHaveBeenCalledOnce();
    expect(await screen.findByText('重新登录')).toBeInTheDocument();
  });

  it('没有恢复会话时拒绝修改密码', () => {
    render(
      <AuthContext.Provider value={value({ user: null })}>
        <MemoryRouter>
          <ResetPasswordPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByRole('heading', { name: '链接已失效' })).toBeInTheDocument();
  });
});
