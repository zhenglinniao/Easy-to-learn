import type { PersistedTutorBoardV2 } from '@easy-to-learn/domain';
import { TutorBoard } from '@easy-to-learn/ui';
import { useState } from 'react';

import './tutor-board-spike.css';

const initialBoard: PersistedTutorBoardV2 = {
  id: 'preview-tutor',
  title: '解一元一次方程',
  stepIndex: 0,
  sceneAnchor: { sceneX: 24, sceneY: 96 },
  anchorMode: 'follow-source',
  source: {
    elementIds: ['preview-question'],
    bounds: { x: 520, y: 190, width: 220, height: 80 },
    contentHash: 'preview',
    status: 'active',
  },
  result: {
    schemaVersion: 1,
    mode: 'solve',
    title: '解一元一次方程',
    steps: [
      {
        id: 'move-constant',
        title: '答案先说：x = 4',
        blocks: [
          { type: 'math', latex: 'x = 4', display: true },
          { type: 'math', latex: '2x + 3 - 3 = 11 - 3', display: true },
          {
            type: 'diagram',
            diagram: {
              type: 'comic-strip',
              layout: 'single',
              panels: [
                {
                  id: 'balance',
                  motif: 'balance',
                  pose: 'point',
                  label: '两边一起减 3',
                  caption: '小易把等式当成天平：左边减 3，右边也要同步。',
                  color: 'blue',
                },
              ],
            },
          },
          { type: 'callout', tone: 'info', text: '移项不是“换符号”，本质是等式两边做相同运算。' },
        ],
      },
      {
        id: 'divide',
        title: '两边同时除以 2',
        blocks: [
          { type: 'math', latex: '2x = 8 \\Rightarrow x = 4', display: true },
          {
            type: 'diagram',
            diagram: {
              type: 'comic-strip',
              layout: 'sequence',
              panels: [
                {
                  id: 'divide',
                  motif: 'numbers',
                  pose: 'think',
                  label: '把两份 x 分开',
                  caption: '2x 是两份相同的 x，8 平均分成两份。',
                  color: 'purple',
                },
                {
                  id: 'check',
                  motif: 'idea',
                  pose: 'cheer',
                  label: '代回检查',
                  caption: '2 × 4 + 3 = 11，左右碰头成功。',
                  color: 'green',
                },
              ],
            },
          },
          { type: 'callout', tone: 'success', text: '代回原式可得 2 × 4 + 3 = 11，答案成立。' },
        ],
      },
    ],
    contentProfile: {
      contentKind: 'exercise',
      learningGoal: 'solve',
      goalSource: 'explicit',
      confidence: 'high',
    },
    answerPresentation: {
      problemType: 'simple',
      conclusionPosition: 'first_step',
    },
    metadata: {
      model: 'preview-fixture',
      promptVersion: 'v4',
      generatedAt: '2026-09-22T00:00:00.000Z',
    },
  },
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
};

export default function TutorBoardSpikePage() {
  const [board, setBoard] = useState<PersistedTutorBoardV2 | null>(initialBoard);
  return (
    <main className="tutor-spike">
      <section className="tutor-spike__question" aria-label="示例原题">
        <span>示例原题</span>
        <strong>2x + 3 = 11</strong>
      </section>
      {board ? (
        <TutorBoard
          board={board}
          onChange={setBoard}
          onClose={() => setBoard(null)}
          onExplainStep={() => undefined}
        />
      ) : (
        <button
          type="button"
          className="tutor-spike__restore"
          onClick={() => setBoard(initialBoard)}
        >
          恢复辅导板
        </button>
      )}
    </main>
  );
}
