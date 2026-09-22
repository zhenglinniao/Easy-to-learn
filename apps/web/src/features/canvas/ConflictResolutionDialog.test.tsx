import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConflictResolutionDialog } from './ConflictResolutionDialog';

describe('ConflictResolutionDialog', () => {
  it('只提供已确认的三条安全恢复路径', () => {
    render(
      <ConflictResolutionDialog
        busy={false}
        error={null}
        onOpenRemote={vi.fn()}
        onSaveAsNew={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /打开云端版本/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /本地版本另存为新画板/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下载本地完整副本/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /强制覆盖/ })).not.toBeInTheDocument();
  });

  it('繁忙时阻止重复操作并展示恢复错误', () => {
    const openRemote = vi.fn();
    const { rerender } = render(
      <ConflictResolutionDialog
        busy
        error="云端暂时不可用"
        onOpenRemote={openRemote}
        onSaveAsNew={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: /打开云端版本/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(openRemote).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('云端暂时不可用');

    rerender(
      <ConflictResolutionDialog
        busy={false}
        error={null}
        onOpenRemote={openRemote}
        onSaveAsNew={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /打开云端版本/ }));
    expect(openRemote).toHaveBeenCalledOnce();
  });
});
