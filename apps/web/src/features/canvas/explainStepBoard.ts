import type { PersistedTutorBoardV2, TutorResultV1 } from '@easy-to-learn/domain';

interface ExplainStepBoardInput {
  parent: PersistedTutorBoardV2;
  targetStepId: string;
  result: TutorResultV1;
  id: string;
  requestId: string;
  now: string;
}

export const createExplainStepBoard = ({
  parent,
  targetStepId,
  result,
  id,
  requestId,
  now,
}: ExplainStepBoardInput): PersistedTutorBoardV2 => {
  const child: PersistedTutorBoardV2 = {
    ...parent,
    id,
    requestId,
    title: `深入解释：${parent.result.steps.find(({ id: stepId }) => stepId === targetStepId)?.title ?? '当前步骤'}`,
    result,
    stepIndex: 0,
    sceneAnchor: {
      sceneX: parent.sceneAnchor.sceneX + 420,
      sceneY: parent.sceneAnchor.sceneY,
    },
    parentTutorBoardId: parent.id,
    targetStepId,
    createdAt: now,
    updatedAt: now,
  };
  // 父辅导板的插画只与父结果中的步骤绑定；解释结果必须自行生成或保持无图。
  delete child.stepIllustration;
  return child;
};
