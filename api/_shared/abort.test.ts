import { describe, expect, it } from 'vitest';

import { withAbortSignal } from './abort.js';

describe('withAbortSignal', () => {
  it('returns the operation result and removes the abort listener', async () => {
    const controller = new AbortController();
    await expect(withAbortSignal(Promise.resolve('done'), controller.signal)).resolves.toBe('done');
    controller.abort();
  });

  it('rejects promptly when a non-cooperative operation ignores cancellation', async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => undefined);
    const result = withAbortSignal(never, controller.signal);

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(withAbortSignal(Promise.resolve('late'), controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });
});
