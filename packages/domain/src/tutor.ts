import { z } from 'zod';

import { MAX_TUTOR_RESULT_BYTES, TUTOR_SCHEMA_VERSION } from './constants';
import {
  finiteNumberSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  serializedUtf8ByteLength,
} from './common';

const titleSchema = z.string().min(1).max(120);
const bodyTextSchema = z.string().min(1).max(2_000);
const listItemSchema = z.string().min(1).max(500);
const diagramCoordinateSchema = finiteNumberSchema.min(-10_000).max(10_000);
const coordinatePairSchema = z.tuple([diagramCoordinateSchema, diagramCoordinateSchema]);
const diagramIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const diagramLabelSchema = z.string().min(1).max(80);

export const diagramColorSchema = z.enum(['neutral', 'blue', 'green', 'amber', 'red', 'purple']);

const coordinateRangeSchema = z
  .tuple([diagramCoordinateSchema, diagramCoordinateSchema])
  .refine(([start, end]) => start < end, '坐标范围起点必须小于终点');

export const coordinatePlaneSchema = z.strictObject({
  type: z.literal('coordinate-plane'),
  xRange: coordinateRangeSchema,
  yRange: coordinateRangeSchema,
  showGrid: z.boolean(),
  showAxes: z.boolean(),
  points: z
    .array(
      z.strictObject({
        id: nonEmptyStringSchema,
        x: diagramCoordinateSchema,
        y: diagramCoordinateSchema,
        label: diagramLabelSchema.optional(),
        color: diagramColorSchema,
      }),
    )
    .max(50),
  segments: z
    .array(
      z.strictObject({
        from: coordinatePairSchema,
        to: coordinatePairSchema,
        label: diagramLabelSchema.optional(),
        color: diagramColorSchema,
      }),
    )
    .max(50),
});

const geometryPointSchema = z.strictObject({
  kind: z.literal('point'),
  id: nonEmptyStringSchema,
  at: coordinatePairSchema,
  label: diagramLabelSchema.optional(),
  color: diagramColorSchema,
});

const geometrySegmentSchema = z.strictObject({
  kind: z.literal('segment'),
  from: coordinatePairSchema,
  to: coordinatePairSchema,
  label: diagramLabelSchema.optional(),
  color: diagramColorSchema,
});

const geometryPolygonSchema = z.strictObject({
  kind: z.literal('polygon'),
  points: z.array(coordinatePairSchema).min(3).max(20),
  label: diagramLabelSchema.optional(),
  color: diagramColorSchema,
  filled: z.boolean(),
});

const geometryCircleSchema = z.strictObject({
  kind: z.literal('circle'),
  center: coordinatePairSchema,
  radius: finiteNumberSchema.positive().max(10_000),
  label: diagramLabelSchema.optional(),
  color: diagramColorSchema,
});

const geometryAngleSchema = z.strictObject({
  kind: z.literal('angle'),
  vertex: coordinatePairSchema,
  from: coordinatePairSchema,
  to: coordinatePairSchema,
  label: diagramLabelSchema.optional(),
  color: diagramColorSchema,
});

export const geometryPrimitiveSchema = z.discriminatedUnion('kind', [
  geometryPointSchema,
  geometrySegmentSchema,
  geometryPolygonSchema,
  geometryCircleSchema,
  geometryAngleSchema,
]);

export const geometryDiagramSchema = z.strictObject({
  type: z.literal('geometry'),
  viewport: z
    .strictObject({
      xMin: diagramCoordinateSchema,
      xMax: diagramCoordinateSchema,
      yMin: diagramCoordinateSchema,
      yMax: diagramCoordinateSchema,
    })
    .refine(({ xMin, xMax }) => xMin < xMax, 'viewport.xMin 必须小于 xMax')
    .refine(({ yMin, yMax }) => yMin < yMax, 'viewport.yMin 必须小于 yMax'),
  primitives: z.array(geometryPrimitiveSchema).max(100),
});

export const flowDiagramSchema = z
  .strictObject({
    type: z.literal('flow'),
    direction: z.enum(['TB', 'LR']),
    nodes: z
      .array(
        z.strictObject({
          id: diagramIdSchema,
          label: z.string().min(1).max(120),
          shape: z.enum(['rectangle', 'rounded', 'diamond']),
          color: diagramColorSchema,
        }),
      )
      .max(30),
    edges: z
      .array(
        z.strictObject({
          id: diagramIdSchema,
          from: diagramIdSchema,
          to: diagramIdSchema,
          label: diagramLabelSchema.optional(),
          style: z.enum(['solid', 'dashed']),
        }),
      )
      .max(60),
  })
  .superRefine(({ nodes, edges }, context) => {
    const nodeIds = new Set(nodes.map(({ id }) => id));
    if (nodeIds.size !== nodes.length) {
      context.addIssue({ code: 'custom', path: ['nodes'], message: '流程图节点 ID 必须唯一' });
    }

    const edgeIds = new Set<string>();
    const edgePairs = new Set<string>();
    edges.forEach((edge, index) => {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: '流程图边必须引用已存在的节点',
        });
      }
      if (edge.from === edge.to) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: '流程图不允许自环',
        });
      }
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index, 'id'],
          message: '流程图边 ID 必须唯一',
        });
      }
      edgeIds.add(edge.id);

      const pair = `${edge.from}\u0000${edge.to}`;
      if (edgePairs.has(pair)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: '流程图不允许重复边',
        });
      }
      edgePairs.add(pair);
    });
  });

export const comicStripSchema = z.strictObject({
  type: z.literal('comic-strip'),
  layout: z.enum(['single', 'sequence']),
  panels: z
    .array(
      z.strictObject({
        id: diagramIdSchema,
        motif: z.enum([
          'idea',
          'balance',
          'magnifier',
          'puzzle',
          'numbers',
          'shapes',
          'book',
          'sprout',
          'food',
          'gear',
          'chart',
        ]),
        pose: z.enum(['point', 'think', 'cheer', 'observe']),
        label: diagramLabelSchema,
        caption: z.string().min(1).max(160),
        color: diagramColorSchema,
      }),
    )
    .min(1)
    .max(4),
});

export const partMapSchema = z
  .strictObject({
    type: z.literal('part-map'),
    layout: z.enum(['exploded', 'layers', 'callout']),
    subject: z.strictObject({
      label: diagramLabelSchema,
      motif: z.enum(['object', 'food', 'plant', 'body', 'device', 'concept']),
      color: diagramColorSchema,
    }),
    parts: z
      .array(
        z.strictObject({
          id: diagramIdSchema,
          label: diagramLabelSchema,
          detail: z.string().min(1).max(140),
          role: z.enum([
            'shell',
            'core',
            'layer',
            'component',
            'ingredient',
            'material',
            'input',
            'output',
          ]),
          color: diagramColorSchema,
        }),
      )
      .min(2)
      .max(10),
    takeaway: z.string().min(1).max(180),
  })
  .superRefine(({ parts }, context) => {
    if (new Set(parts.map(({ id }) => id)).size !== parts.length) {
      context.addIssue({ code: 'custom', path: ['parts'], message: '结构拆解图部件 ID 必须唯一' });
    }
  });

export const diagramSchema = z.discriminatedUnion('type', [
  coordinatePlaneSchema,
  geometryDiagramSchema,
  flowDiagramSchema,
  comicStripSchema,
  partMapSchema,
]);

export const tutorBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paragraph'), text: bodyTextSchema }),
  z.strictObject({
    type: z.literal('math'),
    latex: z.string().min(1).max(2_000),
    display: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('code'),
    language: z.enum(['text', 'javascript', 'typescript', 'java', 'python', 'sql', 'c', 'cpp']),
    code: z.string().min(1).max(4_000),
  }),
  z.strictObject({
    type: z.literal('list'),
    style: z.enum(['ordered', 'unordered']),
    items: z.array(listItemSchema).min(1).max(20),
  }),
  z.strictObject({
    type: z.literal('callout'),
    tone: z.enum(['info', 'warning', 'success']),
    text: bodyTextSchema,
  }),
  z.strictObject({ type: z.literal('diagram'), diagram: diagramSchema }),
]);

export const tutorStepSchema = z.strictObject({
  id: nonEmptyStringSchema,
  title: titleSchema,
  blocks: z.array(tutorBlockSchema).min(1).max(30),
  explanation: z.string().optional(),
  hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

const answerPresentationSchema = z.strictObject({
  problemType: z.enum(['simple', 'reasoning']),
  conclusionPosition: z.enum(['first_step', 'final_step']),
});

const contentProfileSchema = z.strictObject({
  contentKind: z.enum([
    'exercise',
    'question',
    'article',
    'food_dish',
    'produce',
    'object',
    'process',
    'diagram',
    'mixed',
    'unknown',
  ]),
  learningGoal: z.enum([
    'solve',
    'explain',
    'summarize',
    'recipe',
    'nutrition',
    'production',
    'growth',
    'mechanism',
    'compare',
    'explore',
  ]),
  goalSource: z.enum(['explicit', 'inferred']),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const tutorResultSchema = z
  .strictObject({
    schemaVersion: z.literal(TUTOR_SCHEMA_VERSION),
    mode: z.enum(['solve', 'hint', 'explain_step']),
    title: titleSchema,
    steps: z.array(tutorStepSchema).min(1).max(12),
    hintLevel: z.literal(3).optional(),
    answerPresentation: answerPresentationSchema.optional(),
    contentProfile: contentProfileSchema.optional(),
    metadata: z.strictObject({
      model: nonEmptyStringSchema,
      promptVersion: nonEmptyStringSchema,
      generatedAt: isoDateTimeSchema,
    }),
  })
  .superRefine((result, context) => {
    const { mode, steps, hintLevel, answerPresentation, contentProfile, metadata } = result;
    const byteLength = serializedUtf8ByteLength(result);
    if (byteLength === null || byteLength > MAX_TUTOR_RESULT_BYTES) {
      context.addIssue({ code: 'custom', message: 'Tutor 响应 JSON 超过 100 KiB' });
    }

    if (new Set(steps.map(({ id }) => id)).size !== steps.length) {
      context.addIssue({ code: 'custom', path: ['steps'], message: '步骤 ID 必须唯一' });
    }

    if (mode === 'solve' && metadata.promptVersion === 'v2') {
      if (!answerPresentation) {
        context.addIssue({
          code: 'custom',
          path: ['answerPresentation'],
          message: 'Prompt v2 的 Solve 结果必须声明答案呈现策略',
        });
      } else if (
        (answerPresentation.problemType === 'simple' &&
          answerPresentation.conclusionPosition !== 'first_step') ||
        (answerPresentation.problemType === 'reasoning' &&
          answerPresentation.conclusionPosition !== 'final_step')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['answerPresentation'],
          message: '答案位置必须与题型一致',
        });
      }
    } else if (['v3', 'v4', 'v5'].includes(metadata.promptVersion)) {
      if (!contentProfile) {
        context.addIssue({
          code: 'custom',
          path: ['contentProfile'],
          message: 'Prompt v3/v4/v5 结果必须声明内容与学习目标路由',
        });
      }

      if (mode === 'solve' && contentProfile?.learningGoal === 'solve') {
        if (!answerPresentation) {
          context.addIssue({
            code: 'custom',
            path: ['answerPresentation'],
            message: 'Prompt v3/v4/v5 的求解型拆解必须声明答案呈现策略',
          });
        } else if (
          (answerPresentation.problemType === 'simple' &&
            answerPresentation.conclusionPosition !== 'first_step') ||
          (answerPresentation.problemType === 'reasoning' &&
            answerPresentation.conclusionPosition !== 'final_step')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['answerPresentation'],
            message: '答案位置不匹配：simple 必须使用 first_step，reasoning 必须使用 final_step',
          });
        }
      } else if (answerPresentation !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['answerPresentation'],
          message: '只有完整求解型拆解可以声明答案呈现策略',
        });
      }
    } else if (answerPresentation !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['answerPresentation'],
        message: '当前 Prompt 版本不允许声明答案呈现策略',
      });
    }

    if (!['v3', 'v4', 'v5'].includes(metadata.promptVersion) && contentProfile !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['contentProfile'],
        message: '只有 Prompt v3/v4/v5 结果可以声明内容与学习目标路由',
      });
    }

    if (
      ['v4', 'v5'].includes(metadata.promptVersion) &&
      steps.some((step) => step.blocks.every((block) => block.type !== 'diagram'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Prompt v4/v5 的每一步都必须包含至少一个有信息量的图解',
      });
    }

    if (
      metadata.promptVersion === 'v5' &&
      steps.some((step) => step.blocks.every((block) => block.type === 'diagram'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Prompt v5 的每一步都必须用简短文字、公式或提示框解释图解',
      });
    }

    const hasMath = steps.some((step) => step.blocks.some((block) => block.type === 'math'));
    const hasComic = steps.some((step) =>
      step.blocks.some((block) => block.type === 'diagram' && block.diagram.type === 'comic-strip'),
    );
    if (metadata.promptVersion === 'v5' && hasMath && !hasComic) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Prompt v5 的数学图文讲解必须至少包含一个 Q 版 comic-strip 推理提示',
      });
    }

    if (
      metadata.promptVersion === 'v5' &&
      contentProfile?.goalSource === 'inferred' &&
      ((contentProfile.contentKind === 'produce' && contentProfile.learningGoal !== 'nutrition') ||
        (contentProfile.contentKind === 'food_dish' && contentProfile.learningGoal !== 'recipe'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['contentProfile', 'learningGoal'],
        message: '无明确问题时 produce 必须使用 nutrition，food_dish 必须使用 recipe',
      });
    }

    if (mode === 'hint') {
      if (steps.length !== 3) {
        context.addIssue({ code: 'custom', path: ['steps'], message: 'Hint 必须包含 3 个步骤' });
      }
      steps.forEach((step, index) => {
        if (step.hintLevel !== index + 1) {
          context.addIssue({
            code: 'custom',
            path: ['steps', index, 'hintLevel'],
            message: `第 ${index + 1} 个 Hint 的级别必须为 ${index + 1}`,
          });
        }
      });
      if (hintLevel !== 3) {
        context.addIssue({ code: 'custom', path: ['hintLevel'], message: 'Hint 结果级别必须为 3' });
      }
      return;
    }

    if (hintLevel !== undefined || steps.some((step) => step.hintLevel !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['hintLevel'],
        message: '非 Hint 结果不能携带 hintLevel',
      });
    }
  });

export const parseTutorResult = (input: unknown) => {
  const byteLength = serializedUtf8ByteLength(input);
  if (byteLength === null || byteLength > MAX_TUTOR_RESULT_BYTES) {
    throw new Error('Tutor 响应 JSON 超过 100 KiB');
  }
  return tutorResultSchema.parse(input);
};

export type DiagramColor = z.infer<typeof diagramColorSchema>;
export type DiagramV1 = z.infer<typeof diagramSchema>;
export type TutorBlock = z.infer<typeof tutorBlockSchema>;
export type TutorStepV1 = z.infer<typeof tutorStepSchema>;
export type TutorResultV1 = z.infer<typeof tutorResultSchema>;
