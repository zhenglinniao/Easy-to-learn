import { useEffect, useState, type CSSProperties } from 'react';

import styles from './CanvasPage.module.css';
import { MAX_CONCURRENT_CANVAS_AI_TASKS, type CanvasAiTask } from './aiTaskRegistry';

interface AiTaskActivityProps {
  tasks: CanvasAiTask[];
  onCancel(taskId: string): void;
}

const actionLabel = (action: CanvasAiTask['action']): string => {
  if (action === 'solve') return '解题';
  if (action === 'hint') return '提示';
  return '解释步骤';
};

const stageLabel = (stage: CanvasAiTask['stage']): string => {
  if (stage === 'preparing') return '准备选区';
  if (stage === 'answering') return '生成答案';
  return '生成插画';
};

const progress = (task: CanvasAiTask): number => {
  if (task.stage === 'preparing') return 18;
  if (task.stage === 'answering') return task.action === 'hint' ? 76 : 62;
  return 90;
};

const elapsedLabel = (startedAt: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  if (seconds < 60) return `已等待 ${seconds} 秒`;
  return `已等待 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function AiTaskActivity({ tasks, onCancel }: AiTaskActivityProps) {
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (tasks.length === 0) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [tasks.length]);

  if (tasks.length === 0) return null;

  return (
    <>
      {tasks.map((task) =>
        task.screenPosition ? (
          <article
            key={`feedback-${task.id}`}
            className={styles.aiTaskFeedback}
            style={
              {
                left: task.screenPosition.x,
                top: task.screenPosition.y,
                '--task-progress': `${progress(task)}%`,
              } as CSSProperties
            }
            role="status"
            aria-live="polite"
            aria-label={`${actionLabel(task.action)}任务：${stageLabel(task.stage)}，${elapsedLabel(task.startedAt, clock)}`}
          >
            <span className={styles.aiTaskSpinner} aria-hidden="true" />
            <p>
              <strong>
                {actionLabel(task.action)}中 · {stageLabel(task.stage)}
              </strong>
              <span>{elapsedLabel(task.startedAt, clock)}，完成后会自动放到画布</span>
            </p>
            <button type="button" onClick={() => onCancel(task.id)}>
              取消
            </button>
            <span
              className={styles.aiTaskProgress}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress(task)}
              aria-valuetext={stageLabel(task.stage)}
            />
          </article>
        ) : null,
      )}
      <section className={styles.aiTaskDock} aria-label="正在运行的 AI 任务" aria-live="polite">
        <header>
          <strong>AI 并发任务</strong>
          <span>
            {tasks.length}/{MAX_CONCURRENT_CANVAS_AI_TASKS}
          </span>
        </header>
        <div>
          {tasks.map((task, index) => (
            <article key={task.id}>
              <span className={styles.aiTaskIndex}>{index + 1}</span>
              <p>
                <strong>{actionLabel(task.action)}</strong>
                <span>
                  {stageLabel(task.stage)}
                  {task.elementCount ? ` · ${task.elementCount} 个元素` : ''}
                  {` · ${elapsedLabel(task.startedAt, clock)}`}
                </span>
              </p>
              <button
                type="button"
                onClick={() => onCancel(task.id)}
                aria-label={`取消${actionLabel(task.action)}任务`}
              >
                取消
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
