import { tutorResultSchema, type TutorRequest } from '@easy-to-learn/domain';
import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';

import { createTutorModelFromEnvironment } from './ai-provider.js';
import { MemoryAiStateStore } from './ai-state.js';
import { TutorService } from './tutor-service.js';

const runIntegration = process.env.RUN_AI_INTEGRATION === '1';
const environment = loadEnv('development', process.cwd(), '');

const request = (text: string): TutorRequest => ({
  requestId: crypto.randomUUID(),
  schemaVersion: 1,
  boardId: 'local_integration',
  mode: 'solve',
  text,
  locale: 'zh-CN',
  source: {
    elementIds: ['integration-text'],
    selectionBounds: { x: 0, y: 0, width: 240, height: 100 },
    contentHash: `integration-${text.length}`,
  },
});

describe.skipIf(!runIntegration)('真实 AI Provider 黄金集', () => {
  const model = createTutorModelFromEnvironment(async () => '', environment);
  const execute = async (input: TutorRequest, includeDiagnostics = false) => {
    const attempts: unknown[] = [];
    const instrumentedModel = {
      generate: async (modelInput: TutorRequest, correction?: string) => {
        const candidate = await model.generate(modelInput, correction);
        attempts.push(candidate);
        return candidate;
      },
    };
    const service = new TutorService(
      new MemoryAiStateStore(),
      instrumentedModel,
      { canAccess: async () => true },
      () => new Date(),
    );
    try {
      return (await service.execute({ kind: 'anonymous', id: input.requestId }, input)).data.result;
    } catch (error) {
      if (!includeDiagnostics) throw error;
      const diagnostics = attempts.map((candidate) => {
        const parsed = tutorResultSchema.safeParse(candidate);
        return parsed.success
          ? []
          : parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message }));
      });
      throw new Error(`真实 Provider 输出连续不合规：${JSON.stringify(diagnostics)}`, {
        cause: error,
      });
    }
  };

  it('为简单习题返回结论前置、可渲染的 Tutor DSL', async () => {
    const result = tutorResultSchema.parse(await execute(request('解方程：2x + 3 = 11'), true));
    expect(result.contentProfile).toMatchObject({
      contentKind: 'exercise',
      learningGoal: 'solve',
    });
    expect(result.answerPresentation).toEqual({
      problemType: 'simple',
      conclusionPosition: 'first_step',
    });
    expect(
      result.steps.every((step) => step.blocks.some((block) => block.type === 'diagram')),
    ).toBe(true);
    expect(
      result.steps.every((step) => step.blocks.some((block) => block.type !== 'diagram')),
    ).toBe(true);
    expect(result.steps.some((step) => step.blocks.some((block) => block.type === 'math'))).toBe(
      true,
    );
    expect(
      result.steps.some((step) =>
        step.blocks.some(
          (block) => block.type === 'diagram' && block.diagram.type === 'comic-strip',
        ),
      ),
    ).toBe(true);
  }, 35_000);

  it('为没有显式问题的蔬果选择营养拆解路线', async () => {
    const result = tutorResultSchema.parse(
      await execute(request('画布上是一颗番茄，没有附加问题。'), true),
    );
    expect(result.contentProfile).toMatchObject({
      contentKind: 'produce',
      learningGoal: 'nutrition',
      goalSource: 'inferred',
    });
  }, 35_000);

  it('按爆炸拆解图解释日常物体的组成和作用', async () => {
    const result = tutorResultSchema.parse(
      await execute(
        request('请用手绘爆炸拆解图解释一支按压式香水瓶由哪些主要部件组成，以及各部件的作用。'),
        true,
      ),
    );
    expect(result.contentProfile).toMatchObject({
      contentKind: 'object',
      goalSource: 'explicit',
    });
    expect(['explain', 'mechanism']).toContain(result.contentProfile?.learningGoal);
    expect(
      result.steps.some((step) =>
        step.blocks.some((block) => block.type === 'diagram' && block.diagram.type === 'part-map'),
      ),
    ).toBe(true);
  }, 35_000);

  it('用准确代码和图解解释编程概念', async () => {
    const result = tutorResultSchema.parse(
      await execute(
        request(
          '解释 Java 的 Class 对象是什么，并用一个准确的最小 Java 代码示例配合结构图讲清楚。',
        ),
        true,
      ),
    );
    expect(result.steps.some((step) => step.blocks.some((block) => block.type === 'code'))).toBe(
      true,
    );
    expect(
      result.steps.every((step) => step.blocks.some((block) => block.type === 'diagram')),
    ).toBe(true);
  }, 35_000);

  it('接受真实 PNG 图文输入并返回可渲染结构', async () => {
    const input = request('请拆解这张画布图片；图片只用于验证多模态传输。');
    const multimodalRequest: TutorRequest = {
      ...input,
      image: {
        mimeType: 'image/png',
        base64:
          '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',
      },
    };
    const result = await execute(multimodalRequest, true);
    expect(tutorResultSchema.safeParse(result).success).toBe(true);
    expect(result.contentProfile).toBeDefined();
  }, 35_000);
});
