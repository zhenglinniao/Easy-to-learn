import { persistedTutorBoardSchema, type PersistedTutorBoardV2 } from '@easy-to-learn/domain';
import { describe, expect, it } from 'vitest';

import { createExplainStepBoard } from './explainStepBoard';

const now = '2026-09-27T04:00:00.000Z';
const parent: PersistedTutorBoardV2 = {
  id: 'parent-board',
  requestId: '00000000-0000-4000-8000-000000000001',
  title: '原始解答',
  result: {
    schemaVersion: 1,
    mode: 'solve',
    title: '原始解答',
    steps: [
      {
        id: 'parent-step',
        title: '需要解释的步骤',
        blocks: [{ type: 'paragraph', text: '原始说明。' }],
      },
    ],
    metadata: { model: 'test/model', promptVersion: 'v1', generatedAt: now },
  },
  stepIndex: 0,
  sceneAnchor: { sceneX: 100, sceneY: 200 },
  anchorMode: 'follow-source',
  source: {
    elementIds: ['element-1'],
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    contentHash: 'source-hash',
    status: 'active',
  },
  stepIllustration: {
    stepId: 'parent-step',
    fileId: 'image-1',
    altText: '父步骤插画',
    caption: '只属于父步骤。',
  },
  createdAt: now,
  updatedAt: now,
};

describe('createExplainStepBoard', () => {
  it('does not copy a parent illustration into a different explanation result', () => {
    const child = createExplainStepBoard({
      parent,
      targetStepId: 'parent-step',
      id: 'child-board',
      requestId: '00000000-0000-4000-8000-000000000002',
      now,
      result: {
        ...parent.result,
        mode: 'explain_step',
        title: '深入解释',
        steps: [
          {
            id: 'child-step',
            title: '补充原因',
            blocks: [{ type: 'paragraph', text: '新增解释。' }],
          },
        ],
      },
    });

    expect(child.stepIllustration).toBeUndefined();
    expect(child).toMatchObject({
      parentTutorBoardId: parent.id,
      targetStepId: 'parent-step',
      title: '深入解释：需要解释的步骤',
      sceneAnchor: { sceneX: 520, sceneY: 200 },
    });
    expect(persistedTutorBoardSchema.safeParse(child).success).toBe(true);
  });
});
