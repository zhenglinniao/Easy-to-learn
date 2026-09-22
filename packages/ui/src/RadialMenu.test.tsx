import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RadialMenu } from './RadialMenu';

describe('RadialMenu', () => {
  it('执行 Solve/Hint 并支持左右方向键与 Escape', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <RadialMenu x={100} y={100} loadingAction={null} onAction={onAction} onClose={onClose} />,
    );
    const solve = screen.getByRole('button', { name: '解题（Solve）' });
    const hint = screen.getByRole('button', { name: '提示（Hint）' });

    solve.focus();
    await user.keyboard('{ArrowRight}');
    expect(hint).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(solve).toHaveFocus();
    await user.click(solve);
    expect(onAction).toHaveBeenCalledWith('solve');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('请求期间禁用重复提交并公告加载动作', () => {
    render(
      <RadialMenu x={100} y={100} loadingAction="hint" onAction={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('toolbar', { name: 'AI 学习操作' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: '解题（Solve）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '提示（Hint）' })).toBeDisabled();
    expect(screen.getByText('提示请求正在准备')).toBeInTheDocument();
  });
});
