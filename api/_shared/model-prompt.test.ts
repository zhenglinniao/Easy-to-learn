import type { TutorRequest } from '@easy-to-learn/domain';
import { describe, expect, it } from 'vitest';

import tutorPromptRegistry from '../../skills/canvas-tutor-planner/references/prompt-registry.json';

import {
  buildTutorPrompt,
  DEFAULT_TUTOR_PROMPT_VERSION,
  resolveTutorPromptVersion,
  TUTOR_SYSTEM_INSTRUCTION,
} from './model-prompt';

const request = (mode: TutorRequest['mode']): TutorRequest => ({
  requestId: `request-${mode}`,
  schemaVersion: 1,
  boardId: 'local_board-1',
  mode,
  text: '2x + 3 = 11',
  locale: 'zh-CN',
  source: {
    elementIds: ['text-1'],
    selectionBounds: { x: 0, y: 0, width: 100, height: 40 },
    contentHash: 'prompt-registry-test',
  },
  ...(mode === 'explain_step'
    ? {
        parentTutorBoardId: 'parent-1',
        targetStepId: 'step-1',
        parentContext: {
          title: '一元一次方程',
          step: {
            id: 'step-1',
            title: '移项',
            blocks: [{ type: 'paragraph' as const, text: '先把常数项移到右边。' }],
          },
        },
      }
    : {}),
});

describe('Tutor Skill prompt registry', () => {
  it('以项目 Skill 注册表作为生产 Prompt 的唯一来源', () => {
    const defaultPrompt = tutorPromptRegistry.versions.v3;
    expect(DEFAULT_TUTOR_PROMPT_VERSION).toBe(tutorPromptRegistry.defaultVersion);
    expect(TUTOR_SYSTEM_INSTRUCTION).toBe(defaultPrompt.systemInstruction);

    for (const mode of ['solve', 'hint', 'explain_step'] as const) {
      expect(buildTutorPrompt(request(mode))).toContain(defaultPrompt.modeInstructions[mode]);
    }
    expect(buildTutorPrompt(request('solve'))).toContain('contentProfile');
    expect(buildTutorPrompt(request('solve'))).toContain('answerPresentation');
  });

  it('只为 explain_step 注入已经验证的父步骤上下文', () => {
    const prompt = buildTutorPrompt(request('explain_step'));
    expect(prompt).toContain('父辅导板：parent-1');
    expect(prompt).toContain('目标步骤：step-1');
    expect(prompt).toContain('目标步骤已验证内容');
    expect(prompt).toContain('先把常数项移到右边');
    expect(buildTutorPrompt(request('solve'))).not.toContain('父辅导板');
  });

  it('拒绝元数据与真实内容不一致的未知 Prompt 版本', () => {
    expect(resolveTutorPromptVersion('v1')).toBe('v1');
    expect(resolveTutorPromptVersion('v2')).toBe('v2');
    expect(resolveTutorPromptVersion('v3')).toBe('v3');
    expect(() => resolveTutorPromptVersion('v999')).toThrow(/未知 Tutor Prompt 版本/);
  });
});
