import type { AiFeedbackCategory, PersistedTutorBoardV2 } from '@easy-to-learn/domain';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { TutorBlocks } from './TutorBlocks';
import styles from './TutorBoard.module.css';

export interface TutorBoardProps {
  board: PersistedTutorBoardV2;
  screenPosition?: { x: number; y: number };
  sceneUnitsPerClientPixel?: number;
  onChange(board: PersistedTutorBoardV2): void;
  onClose(boardId: string): void;
  onExplainStep?(boardId: string, stepId: string): void;
  feedbackState?: 'idle' | 'sending' | 'sent' | 'error';
  onFeedback?(rating: -1 | 1, category?: AiFeedbackCategory): void;
}

const feedbackCategories: ReadonlyArray<{ value: AiFeedbackCategory; label: string }> = [
  { value: 'incorrect_answer', label: '答案错误' },
  { value: 'unclear_explanation', label: '解释不清' },
  { value: 'unsafe_content', label: '内容不合适' },
  { value: 'other', label: '其他问题' },
];

export function TutorBoard({
  board,
  screenPosition,
  sceneUnitsPerClientPixel = 1,
  onChange,
  onClose,
  onExplainStep,
  feedbackState = 'idle',
  onFeedback,
}: TutorBoardProps) {
  const [showFeedbackCategories, setShowFeedbackCategories] = useState(false);
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
      {onFeedback ? (
        <section className={styles.feedback} aria-label="评价这次 AI 回答">
          {feedbackState === 'sent' ? (
            <p role="status">已收到反馈，谢谢你。</p>
          ) : (
            <>
              <div className={styles.feedbackPrompt}>
                <span>这次回答有帮助吗？</span>
                <div className={styles.feedbackActions}>
                  <button
                    type="button"
                    disabled={feedbackState === 'sending'}
                    onClick={() => onFeedback(1)}
                  >
                    有帮助
                  </button>
                  <button
                    type="button"
                    aria-expanded={showFeedbackCategories}
                    disabled={feedbackState === 'sending'}
                    onClick={() => setShowFeedbackCategories((shown) => !shown)}
                  >
                    有问题
                  </button>
                </div>
              </div>
              {showFeedbackCategories ? (
                <div className={styles.feedbackCategories} aria-label="选择问题类型">
                  {feedbackCategories.map((category) => (
                    <button
                      key={category.value}
                      type="button"
                      disabled={feedbackState === 'sending'}
                      onClick={() => onFeedback(-1, category.value)}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {feedbackState === 'sending' ? <p role="status">正在发送反馈…</p> : null}
              {feedbackState === 'error' ? <p role="alert">发送失败，请重试。</p> : null}
            </>
          )}
        </section>
      ) : null}
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
