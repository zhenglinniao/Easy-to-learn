import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { captureMonitoringException } from '../monitoring';
import { AppErrorBoundary } from './AppErrorBoundary';

vi.mock('../monitoring', () => ({ captureMonitoringException: vi.fn() }));

const Broken = () => {
  throw new Error('render failed');
};

describe('AppErrorBoundary', () => {
  it('渲染失败时提供可恢复的重新加载入口', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('页面暂时没有正常打开');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(captureMonitoringException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
    consoleError.mockRestore();
  });
});
