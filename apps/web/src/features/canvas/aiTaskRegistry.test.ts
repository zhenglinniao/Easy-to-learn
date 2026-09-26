import { describe, expect, it } from 'vitest';

import { CanvasAiTaskRegistry, MAX_CONCURRENT_CANVAS_AI_TASKS } from './aiTaskRegistry';

describe('CanvasAiTaskRegistry', () => {
  it('allows three isolated concurrent tasks and rejects a fourth', () => {
    const registry = new CanvasAiTaskRegistry();
    const controllers = Array.from({ length: MAX_CONCURRENT_CANVAS_AI_TASKS }, (_, index) =>
      registry.start(`task-${index}`, index === 1 ? 'hint' : 'solve'),
    );

    expect(controllers.every(Boolean)).toBe(true);
    expect(registry.start('task-overflow', 'solve')).toBeNull();
    expect(registry.list()).toHaveLength(MAX_CONCURRENT_CANVAS_AI_TASKS);
  });

  it('rejects a duplicate source while preserving independent selections', () => {
    const registry = new CanvasAiTaskRegistry();
    const first = registry.start('first', 'solve', {
      sourceKey: 'selection-a',
      screenPosition: { x: 120, y: 240 },
    });

    expect(first).not.toBeNull();
    expect(registry.start('duplicate', 'solve', { sourceKey: 'selection-a' })).toBeNull();
    expect(registry.start('second', 'solve', { sourceKey: 'selection-b' })).not.toBeNull();
    expect(registry.findBySourceKey('selection-a')).toMatchObject({
      id: 'first',
      action: 'solve',
      stage: 'preparing',
      sourceKey: 'selection-a',
      screenPosition: { x: 120, y: 240 },
    });
  });

  it('updates, cancels and finishes tasks without affecting siblings', () => {
    const registry = new CanvasAiTaskRegistry();
    const first = registry.start('first', 'solve');
    const second = registry.start('second', 'explain_step');

    registry.update('first', { stage: 'illustrating', elementCount: 4 });
    registry.cancel('second');

    expect(second?.signal.aborted).toBe(true);
    expect(first?.signal.aborted).toBe(false);
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: 'first',
        action: 'solve',
        stage: 'illustrating',
        elementCount: 4,
      }),
    ]);

    registry.finish('first');
    expect(registry.list()).toEqual([]);
  });

  it('aborts every task when leaving the board', () => {
    const registry = new CanvasAiTaskRegistry();
    const first = registry.start('first', 'solve');
    const second = registry.start('second', 'hint');

    registry.cancelAll();

    expect(first?.signal.aborted).toBe(true);
    expect(second?.signal.aborted).toBe(true);
    expect(registry.list()).toEqual([]);
  });
});
