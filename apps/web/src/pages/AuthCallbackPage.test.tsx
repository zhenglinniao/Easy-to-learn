import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuthCallbackPage from './AuthCallbackPage';

const mocks = vi.hoisted(() => ({
  completeAuthCallback: vi.fn(),
  client: { auth: {} },
}));

vi.mock('../features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/auth')>()),
  getOptionalSupabaseClient: () => mocks.client,
  completeAuthCallback: mocks.completeAuthCallback,
}));

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeAuthCallback.mockResolvedValue(undefined);
  });

  it('只交换一次 PKCE code 并恢复安全目标页', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/callback?code=valid-code&redirect=/boards']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/boards" element={<p>画板列表</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('画板列表')).toBeInTheDocument();
    expect(mocks.completeAuthCallback).toHaveBeenCalledOnce();
    expect(mocks.completeAuthCallback).toHaveBeenCalledWith(mocks.client, 'valid-code');
  });

  it('恢复密码流程固定进入密码更新页', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/auth/callback?code=recovery-code&flow=recovery&redirect=https://evil.example',
        ]}
      >
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/reset-password" element={<p>更新密码页面</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('更新密码页面')).toBeInTheDocument();
  });

  it('拒绝缺失 code 的回调', () => {
    render(
      <MemoryRouter initialEntries={['/auth/callback?error=access_denied']}>
        <AuthCallbackPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '未能完成登录' })).toBeInTheDocument();
    expect(screen.getByText('认证请求已取消、失效或不完整，请重新登录。')).toBeInTheDocument();
  });
});
