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

vi.mock('../features/auth', () => ({
  useAuth: () => ({
    client: {},
    user: { id: 'user-1', email: 'learner@example.com' },
    loading: false,
  }),
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

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/boards']}>
      <Routes>
        <Route path="/boards" element={<BoardsPage />} />
        <Route path="/canvas/:boardId" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
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
});
