import { useRef, type KeyboardEvent } from 'react';

import styles from './RadialMenu.module.css';

export type RadialMenuAction = 'solve' | 'hint';

export interface RadialMenuProps {
  x: number;
  y: number;
  loadingAction: RadialMenuAction | null;
  onAction(action: RadialMenuAction): void;
  onClose(): void;
}

const actionLabels: Record<RadialMenuAction, { title: string; english: string }> = {
  solve: { title: '解题', english: 'Solve' },
  hint: { title: '提示', english: 'Hint' },
};

export function RadialMenu({ x, y, loadingAction, onAction, onClose }: RadialMenuProps) {
  const solveRef = useRef<HTMLButtonElement>(null);
  const hintRef = useRef<HTMLButtonElement>(null);
  const isLoading = loadingAction !== null;

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (isLoading) return;
    if (event.key === 'ArrowLeft' || event.key === 'Home') {
      event.preventDefault();
      solveRef.current?.focus();
    }
    if (event.key === 'ArrowRight' || event.key === 'End') {
      event.preventDefault();
      hintRef.current?.focus();
    }
  };

  const renderAction = (action: RadialMenuAction, ref: typeof solveRef) => {
    const label = actionLabels[action];
    const loading = loadingAction === action;
    return (
      <button
        ref={ref}
        className={styles.action}
        type="button"
        disabled={isLoading}
        aria-label={`${label.title}（${label.english}）`}
        aria-busy={loading}
        onClick={() => onAction(action)}
      >
        <span className={styles.actionTitle}>{loading ? '处理中' : label.title}</span>
        <span className={styles.actionEnglish}>{loading ? 'Please wait' : label.english}</span>
      </button>
    );
  };

  return (
    <div
      className={styles.menu}
      style={{ left: x, top: y }}
      role="toolbar"
      aria-label="AI 学习操作"
      aria-busy={isLoading}
      onKeyDown={handleKeyboard}
    >
      {renderAction('solve', solveRef)}
      <div className={styles.center} aria-hidden="true">
        <span>✦</span>
        <small>AI</small>
      </div>
      {renderAction('hint', hintRef)}
      <span className={styles.status} aria-live="polite">
        {isLoading ? `${actionLabels[loadingAction].title}请求正在准备` : ''}
      </span>
    </div>
  );
}
