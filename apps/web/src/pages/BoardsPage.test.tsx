import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  pendingDeletion: vi.fn(),
  requestDeletion: vi.fn(),
  cancelDeletion: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  current: {
    client: {},
    user: { id: 'user-1', email: 'learner@example.com' },
    loading: false,
  },
}));

vi.mock('../features/auth', () => ({
  useAuth: () => auth.current,
}));

vi.mock('../features/boards', () => ({
  RemoteBoardRepository: class {
    list = services.list;
    create = services.create;
    rename = services.rename;
    delete = services.remove;
  },
  toBoardMessage: (_cause: unknown, fallback: string) => fallback,
}));

vi.mock('../features/account', () => ({
  AccountService: class {
    pendingDeletion = services.pendingDeletion;
    requestDeletion = services.requestDeletion;
    cancelDeletion = services.cancelDeletion;
  },
}));

vi.mock('./SiteHeader', () => ({ SiteHeader: () => <header>站点导航</header> }));

import BoardsPage from './BoardsPage';

const Location = () => {
  const location = useLocation();
  return <output>{location.pathname}</output>;
};

const page = () => (
  <MemoryRouter initialEntries={['/boards']}>
    <Routes>
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="/canvas/:boardId" element={<Location />} />
    </Routes>
  </MemoryRouter>
);

const renderPage = () => render(page());

beforeEach(() => {
  vi.clearAllMocks();
  auth.current = {
    client: {},
    user: { id: 'user-1', email: 'learner@example.com' },
    loading: false,
  };
  services.list.mockResolvedValue([]);
  services.pendingDeletion.mockResolvedValue(null);
});

describe('BoardsPage', () => {
  it('创建期间提供反馈并在成功后进入新画板', async () => {
    const user = userEvent.setup();
    let resolveCreate: ((value: { boardId: string }) => void) | undefined;
    services.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    renderPage();

    const button = await screen.findByRole('button', { name: '新建画板' });
    await user.click(button);
    expect(screen.getAllByRole('button', { name: '正在创建…' })).toHaveLength(2);
    for (const pendingButton of screen.getAllByRole('button', { name: '正在创建…' })) {
      expect(pendingButton).toBeDisabled();
    }
    expect(services.create).toHaveBeenCalledOnce();

    resolveCreate?.({ boardId: 'board-123' });
    expect(await screen.findByText('/canvas/board-123')).toBeInTheDocument();
  });

  it('账户删除请求进行中禁用入口，避免重复提交', async () => {
    const user = userEvent.setup();
    let resolveDeletion: ((value: { executeAfter: string }) => void) | undefined;
    services.requestDeletion.mockReturnValue(
      new Promise((resolve) => {
        resolveDeletion = resolve;
      }),
    );
    renderPage();

    const button = await screen.findByRole('button', { name: '申请删除账户' });
    await user.click(button);
    const pending = screen.getByRole('button', { name: '正在提交…' });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(services.requestDeletion).toHaveBeenCalledOnce();

    resolveDeletion?.({ executeAfter: '2026-10-04T00:00:00.000Z' });
    await waitFor(() => expect(screen.getByRole('button', { name: '取消删除' })).toBeEnabled());
  });

  it('切换登录账户时不会继续展示上个账户的画板', async () => {
    let resolveNext:
      ((value: Array<{ id: string; title: string; updatedAt: string }>) => void) | undefined;
    services.list
      .mockResolvedValueOnce([
        { id: 'old-board', title: '旧账户私有画板', updatedAt: '2026-09-27T00:00:00.000Z' },
      ])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNext = resolve;
        }),
      );
    const view = renderPage();
    expect(await screen.findByText('旧账户私有画板')).toBeInTheDocument();

    auth.current = {
      ...auth.current,
      user: { id: 'user-2', email: 'second@example.com' },
    };
    view.rerender(page());

    expect(screen.queryByText('旧账户私有画板')).not.toBeInTheDocument();
    expect(screen.getByText('正在整理你的画板…')).toBeInTheDocument();
    resolveNext?.([]);
    expect(await screen.findByText('第一块画板，等你落笔。')).toBeInTheDocument();
  });

  it('切换账户时隐藏上一账户的删除倒计时与画板操作弹窗', async () => {
    const user = userEvent.setup();
    services.list
      .mockResolvedValueOnce([
        { id: 'old-board', title: '旧账户私有画板', updatedAt: '2026-09-27T00:00:00.000Z' },
      ])
      .mockResolvedValueOnce([]);
    services.pendingDeletion
      .mockResolvedValueOnce({ executeAfter: '2026-10-04T00:00:00.000Z' })
      .mockReturnValueOnce(new Promise(() => undefined));
    const view = renderPage();

    await user.click(await screen.findByRole('button', { name: '删除' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('旧账户私有画板');
    expect(await screen.findByRole('button', { name: '取消删除' })).toBeInTheDocument();

    auth.current = {
      ...auth.current,
      user: { id: 'user-2', email: 'second@example.com' },
    };
    view.rerender(page());

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/账户将在/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '申请删除账户' })).toBeInTheDocument();
  });
});
