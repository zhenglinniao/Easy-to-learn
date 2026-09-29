import type { BillingSummary } from '@easy-to-learn/domain';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const overview = vi.hoisted(() => vi.fn());
const useAuth = vi.hoisted(() => vi.fn());

vi.mock('../auth', () => ({ useAuth }));
vi.mock('./service', () => ({
  AccountService: class {
    overview = overview;
  },
}));
vi.mock('../../pages/SiteHeader', () => ({ SiteHeader: () => <nav>测试导航</nav> }));

import AccountPage from './AccountPage';

const summary: BillingSummary = {
  configured: false,
  entitlement: {
    plan: 'free',
    source: 'free',
    subscriptionStatus: 'none',
    actionDailyLimit: 10,
    actionPeriodLimit: 45,
    imageDailyLimit: 2,
    imagePeriodLimit: 20,
    maxBoards: 100,
    maxStorageBytes: 1_073_741_824,
    maxConcurrentAiTasks: 3,
    modelQualityTier: 'standard',
    unlimited: false,
    effectiveUntil: null,
    version: 1,
  },
  quota: {
    dailyLimit: 10,
    remaining: 8,
    nextAllowedAt: null,
    mode: 'full',
    action: {
      dailyLimit: 10,
      dailyRemaining: 8,
      periodLimit: 45,
      periodRemaining: 43,
      nextAllowedAt: null,
      dailyResetsAt: '2026-09-30T00:00:00.000Z',
      periodResetsAt: null,
    },
    image: {
      dailyLimit: 2,
      dailyRemaining: 2,
      periodLimit: 20,
      periodRemaining: 20,
      periodResetsAt: null,
    },
  },
  subscription: null,
  usage: { boards: 3, storageBytes: 2048 },
};

beforeEach(() => {
  overview.mockReset().mockResolvedValue(summary);
  useAuth.mockReturnValue({
    client: {},
    user: { id: 'user-1', email: 'learner@example.com' },
    loading: false,
  });
});

describe('AccountPage', () => {
  it('展示真实套餐、额度、存储和安全入口，并在未配置支付时安全禁用升级', async () => {
    render(
      <MemoryRouter initialEntries={['/account']}>
        <AccountPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '免费版' })).toBeInTheDocument();
    expect(screen.getByText('8 次')).toBeInTheDocument();
    expect(screen.getByText('2 张')).toBeInTheDocument();
    expect(screen.getByText('3 / 100')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '暂未开放' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '暂未开放' })[0]).toBeDisabled();
    expect(screen.getByRole('link', { name: '修改密码' })).toHaveAttribute(
      'href',
      '/reset-password',
    );
  });

  it('账户汇总失败时显示可追踪错误而不是旧账户数据', async () => {
    overview.mockRejectedValue(new Error('账户服务离线'));
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('账户服务离线')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('8 次')).not.toBeInTheDocument());
  });

  it('展示付费版、不限额和周期结束取消状态', async () => {
    overview.mockResolvedValue({
      ...summary,
      configured: true,
      entitlement: {
        ...summary.entitlement,
        plan: 'plus',
        unlimited: true,
        modelQualityTier: 'enhanced',
      },
      subscription: {
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-10-29T00:00:00.000Z',
      },
    });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Plus' })).toBeInTheDocument();
    expect(screen.getAllByText('不限额')).toHaveLength(2);
    expect(screen.getByText('将在当前周期结束后取消')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '管理订阅' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: '按学习强度选择额度' })).not.toBeInTheDocument();
  });

  it('未登录时保留账户目标并跳转登录', async () => {
    useAuth.mockReturnValue({ client: null, user: null, loading: false });
    render(
      <MemoryRouter initialEntries={['/account']}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/login" element={<p>登录入口</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('登录入口')).toBeInTheDocument();
  });
});
