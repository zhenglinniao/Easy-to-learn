export const MAX_CONCURRENT_CANVAS_AI_TASKS = 3;

export type CanvasAiTaskAction = 'solve' | 'hint' | 'explain_step';
export type CanvasAiTaskStage = 'preparing' | 'answering' | 'illustrating';

export interface CanvasAiTask {
  id: string;
  action: CanvasAiTaskAction;
  stage: CanvasAiTaskStage;
  sourceKey?: string;
  startedAt: number;
  screenPosition?: { x: number; y: number };
  elementCount?: number;
}

interface ActiveCanvasAiTask extends CanvasAiTask {
  controller: AbortController;
}

export class CanvasAiTaskRegistry {
  private readonly tasks = new Map<string, ActiveCanvasAiTask>();

  start(
    id: string,
    action: CanvasAiTaskAction,
    context: Pick<CanvasAiTask, 'sourceKey' | 'screenPosition'> = {},
  ): AbortController | null {
    if (
      this.tasks.has(id) ||
      (context.sourceKey && this.findBySourceKey(context.sourceKey)) ||
      this.tasks.size >= MAX_CONCURRENT_CANVAS_AI_TASKS
    )
      return null;
    const controller = new AbortController();
    this.tasks.set(id, {
      id,
      action,
      stage: 'preparing',
      startedAt: Date.now(),
      ...context,
      controller,
    });
    return controller;
  }

  findBySourceKey(sourceKey: string): CanvasAiTask | null {
    const task = Array.from(this.tasks.values()).find(
      (candidate) => candidate.sourceKey === sourceKey,
    );
    if (!task) return null;
    return {
      id: task.id,
      action: task.action,
      stage: task.stage,
      startedAt: task.startedAt,
      ...(task.sourceKey === undefined ? {} : { sourceKey: task.sourceKey }),
      ...(task.screenPosition === undefined ? {} : { screenPosition: task.screenPosition }),
      ...(task.elementCount === undefined ? {} : { elementCount: task.elementCount }),
    };
  }

  update(id: string, update: Partial<Pick<CanvasAiTask, 'stage' | 'elementCount'>>): void {
    const task = this.tasks.get(id);
    if (!task) return;
    this.tasks.set(id, { ...task, ...update });
  }

  finish(id: string): void {
    this.tasks.delete(id);
  }

  cancel(id: string): void {
    this.tasks.get(id)?.controller.abort();
    this.tasks.delete(id);
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) task.controller.abort();
    this.tasks.clear();
  }

  list(): CanvasAiTask[] {
    return Array.from(this.tasks.values(), (task) => ({
      id: task.id,
      action: task.action,
      stage: task.stage,
      startedAt: task.startedAt,
      ...(task.sourceKey === undefined ? {} : { sourceKey: task.sourceKey }),
      ...(task.screenPosition === undefined ? {} : { screenPosition: task.screenPosition }),
      ...(task.elementCount === undefined ? {} : { elementCount: task.elementCount }),
    }));
  }
}
