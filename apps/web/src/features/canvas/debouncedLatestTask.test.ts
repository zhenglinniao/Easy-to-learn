import { describe, expect, it, vi } from 'vitest';

import { DebouncedLatestTask } from './debouncedLatestTask';

describe('DebouncedLatestTask', () => {
  it('coalesces a burst into the latest value', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(async () => undefined);
    const queue = new DebouncedLatestTask(execute);

    queue.schedule(1, 250);
    queue.schedule(2, 250);
    await vi.advanceTimersByTimeAsync(250);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(2);
    vi.useRealTimers();
  });

  it('flushes immediately and cancels the debounce timer', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(async () => undefined);
    const queue = new DebouncedLatestTask(execute);

    queue.schedule('latest', 250);
    await queue.flush();
    await vi.advanceTimersByTimeAsync(250);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('latest');
    vi.useRealTimers();
  });

  it('serializes a newer value queued during an in-flight write', async () => {
    let finishFirst: (() => void) | undefined;
    const order: string[] = [];
    const execute = vi.fn(async (value: string) => {
      order.push(`start:${value}`);
      if (value === 'first') {
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
      }
      order.push(`finish:${value}`);
    });
    const queue = new DebouncedLatestTask(execute);

    queue.schedule('first', 0);
    const firstFlush = queue.flush();
    await Promise.resolve();
    queue.schedule('second', 0);
    const finalFlush = queue.flush();
    expect(order).toEqual(['start:first']);

    finishFirst?.();
    await Promise.all([firstFlush, finalFlush]);

    expect(order).toEqual(['start:first', 'finish:first', 'start:second', 'finish:second']);
  });

  it('flushes the final pending value before disposal', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(async () => undefined);
    const queue = new DebouncedLatestTask(execute);
    queue.schedule(7, 60_000);

    await queue.dispose({ flush: true });

    expect(execute).toHaveBeenCalledWith(7);
    vi.useRealTimers();
  });

  it('reports and rejects a failed explicit flush', async () => {
    const failure = new Error('disk full');
    const onError = vi.fn();
    const queue = new DebouncedLatestTask(async () => Promise.reject(failure), { onError });
    queue.schedule('snapshot', 60_000);

    await expect(queue.flush()).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
