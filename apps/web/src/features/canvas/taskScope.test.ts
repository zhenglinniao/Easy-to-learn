import { describe, expect, it } from 'vitest';

import { isCurrentCanvasTask } from './taskScope';

describe('canvas AI task scope', () => {
  it('accepts only a live task that still belongs to the visible board', () => {
    const controller = new AbortController();
    expect(isCurrentCanvasTask(controller.signal, 'board-a', 'board-a')).toBe(true);
    expect(isCurrentCanvasTask(controller.signal, 'board-a', 'board-b')).toBe(false);

    controller.abort();
    expect(isCurrentCanvasTask(controller.signal, 'board-a', 'board-a')).toBe(false);
  });
});
