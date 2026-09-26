import { describe, expect, it, vi } from 'vitest';

import { mapWithConcurrency } from './mapWithConcurrency';

describe('mapWithConcurrency', () => {
  it('preserves input order while bounding active work', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const worker = vi.fn(async (value: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 2;
    });

    const pending = mapWithConcurrency([1, 2, 3, 4, 5], 2, worker);
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(3));
    releases.shift()?.();
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(4));
    releases.shift()?.();
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(5));
    while (releases.length) releases.shift()?.();

    await expect(pending).resolves.toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });

  it('rejects invalid concurrency before invoking work', async () => {
    const worker = vi.fn(async (value: number) => value);
    await expect(mapWithConcurrency([1], 0, worker)).rejects.toThrow(RangeError);
    expect(worker).not.toHaveBeenCalled();
  });
});
