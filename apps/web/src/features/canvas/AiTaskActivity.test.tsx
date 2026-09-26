import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiTaskActivity } from './AiTaskActivity';

afterEach(() => {
  vi.useRealTimers();
});

describe('AiTaskActivity', () => {
  it('updates elapsed feedback locally and allows cancellation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const onCancel = vi.fn();
    render(
      <AiTaskActivity
        tasks={[
          {
            id: 'task-1',
            action: 'solve',
            stage: 'answering',
            startedAt: 0,
            screenPosition: { x: 20, y: 40 },
            elementCount: 2,
          },
        ]}
        onCancel={onCancel}
      />,
    );

    expect(screen.getAllByText(/已等待 5 秒/)).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveAccessibleName('解题任务：生成答案');
    for (const elapsed of screen.getAllByText(/已等待 5 秒/)) {
      expect(elapsed).toHaveAttribute('aria-hidden', 'true');
    }
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getAllByText(/已等待 6 秒/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '取消解题任务' }));
    expect(onCancel).toHaveBeenCalledWith('task-1');
  });
});
