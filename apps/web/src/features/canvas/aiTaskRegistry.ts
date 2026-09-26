export const MAX_CONCURRENT_CANVAS_AI_TASKS = 3;

export type CanvasAiTaskAction = 'solve' | 'hint' | 'explain_step';
export type CanvasAiTaskStage = 'preparing' | 'answering' | 'illustrating';

export interface CanvasAiTask {
  id: string;
  action: CanvasAiTaskAction;
  stage: CanvasAiTaskStage;
  elementCount?: number;
}

interface ActiveCanvasAiTask extends CanvasAiTask {
  controller: AbortController;
}

export class CanvasAiTaskRegistry {
  private readonly tasks = new Map<string, ActiveCanvasAiTask>();

  start(id: string, action: CanvasAiTaskAction): AbortController | null {
    if (this.tasks.has(id) || this.tasks.size >= MAX_CONCURRENT_CANVAS_AI_TASKS) return null;
    const controller = new AbortController();
    this.tasks.set(id, { id, action, stage: 'preparing', controller });
    return controller;
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
      ...(task.elementCount === undefined ? {} : { elementCount: task.elementCount }),
    }));
  }
}
