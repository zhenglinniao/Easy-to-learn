import type { PersistedTutorBoardV2 } from '@easy-to-learn/domain';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { TutorBlocks } from './TutorBlocks';
import styles from './TutorBoard.module.css';

export interface TutorBoardProps {
  board: PersistedTutorBoardV2;
  screenPosition?: { x: number; y: number };
  sceneUnitsPerClientPixel?: number;
  onChange(board: PersistedTutorBoardV2): void;
  onClose(boardId: string): void;
  onExplainStep?(boardId: string, stepId: string): void;
}

export function TutorBoard({
  board,
  screenPosition,
  sceneUnitsPerClientPixel = 1,
  onChange,
  onClose,
  onExplainStep,
}: TutorBoardProps) {
  const elementRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    sceneX: number;
    sceneY: number;
  } | null>(null);
  const step = board.result.steps[board.stepIndex];

  const changeStep = (nextIndex: number) =>
    onChange({ ...board, stepIndex: nextIndex, updatedAt: new Date().toISOString() });
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current || (event.target as Element).closest('button')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      sceneX: board.sceneAnchor.sceneX,
      sceneY: board.sceneAnchor.sceneY,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !elementRef.current) return;
    elementRef.current.style.transform = `translate3d(${event.clientX - drag.startX}px, ${event.clientY - drag.startY}px, 0)`;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (elementRef.current) elementRef.current.style.transform = '';
    onChange({
      ...board,
      sceneAnchor: {
        sceneX: drag.sceneX + (event.clientX - drag.startX) * sceneUnitsPerClientPixel,
        sceneY: drag.sceneY + (event.clientY - drag.startY) * sceneUnitsPerClientPixel,
      },
      updatedAt: new Date().toISOString(),
    });
  };

  if (!step) return null;
  const isHint = board.result.mode === 'hint';
  return (
    <article
      ref={elementRef}
      className={styles.board}
      style={{
        left: screenPosition?.x ?? board.sceneAnchor.sceneX,
        top: screenPosition?.y ?? board.sceneAnchor.sceneY,
      }}
      aria-label={`AI 辅导：${board.title}`}
    >
      <header
        className={styles.header}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div>
          <span className={styles.eyebrow}>AI TUTOR</span>
          <h2>{board.title}</h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="关闭辅导板"
          onClick={() => onClose(board.id)}
        >
          ×
        </button>
      </header>
      <div className={styles.sourceStatus} data-status={board.source.status}>
        {board.source.status === 'active'
          ? '已连接原题'
          : board.source.status === 'stale'
            ? '原题已更改'
            : '原题已删除'}
      </div>
      <section className={styles.content} aria-live="polite">
        <p className={styles.stepLabel}>步骤 {board.stepIndex + 1}</p>
        <h3>{step.title}</h3>
        <TutorBlocks blocks={step.blocks} />
      </section>
      <footer className={styles.footer}>
        <span>
          {board.stepIndex + 1} / {board.result.steps.length}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={board.stepIndex === 0}
            onClick={() => changeStep(board.stepIndex - 1)}
          >
            上一步
          </button>
          {onExplainStep && board.result.mode !== 'explain_step' && (
            <button type="button" onClick={() => onExplainStep(board.id, step.id)}>
              解释这一步
            </button>
          )}
          <button
            type="button"
            disabled={board.stepIndex >= board.result.steps.length - 1}
            onClick={() => changeStep(board.stepIndex + 1)}
          >
            {isHint ? '显示下一条提示' : '下一步'}
          </button>
        </div>
      </footer>
    </article>
  );
}
