import { describe, expect, it } from 'vitest';

import {
  accountDeletionRequestSchema,
  apiErrorResponseSchema,
  domainJsonSchemas,
  flowDiagramSchema,
  MAX_ASSET_BYTES,
  MAX_BOARD_ASSET_BYTES,
  MAX_CANVAS_SNAPSHOT_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  MAX_TUTOR_RESULT_BYTES,
  parsePersistedCanvas,
  persistedCanvasSchema,
  quotaStatusSchema,
  tutorRequestSchema,
  tutorResultSchema,
  type TutorResultV1,
} from './index';

const generatedAt = '2026-09-22T00:00:00.000Z';

const solveResult: TutorResultV1 = {
  schemaVersion: 1,
  mode: 'solve',
  title: '一元一次方程',
  steps: [
    {
      id: 'step-1',
      title: '移项',
      blocks: [{ type: 'paragraph', text: '先把常数项移到等号右边。' }],
    },
  ],
  metadata: {
    model: 'gemini-3.6-flash',
    promptVersion: 'v1',
    generatedAt,
  },
};

const requestBase = {
  requestId: 'request-1',
  schemaVersion: 1,
  boardId: 'local_board-1',
  locale: 'zh-CN',
  source: {
    elementIds: ['element-1'],
    selectionBounds: { x: 0, y: 0, width: 100, height: 80 },
    contentHash: 'selection-hash',
  },
} as const;

const canvasBase = {
  schemaVersion: 2,
  boardId: 'board-1',
  revision: 0,
  excalidraw: {
    elements: [],
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null,
      gridStep: 20,
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
    },
  },
  assets: [],
  tutorBoards: [],
  updatedAt: generatedAt,
} as const;

describe('Tutor DSL', () => {
  it('接受严格的 Solve 结果并导出禁止额外字段的 JSON Schema', () => {
    expect(tutorResultSchema.parse(solveResult)).toEqual(solveResult);
    expect(domainJsonSchemas.tutorResultV1).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      additionalProperties: false,
    });

    expect(tutorResultSchema.safeParse({ ...solveResult, rawHtml: '<b>unsafe</b>' }).success).toBe(
      false,
    );
  });

  it('强制 Hint 恰好三级且级别顺序固定', () => {
    const hintResult = {
      ...solveResult,
      mode: 'hint',
      hintLevel: 3,
      steps: [1, 2, 3].map((hintLevel) => ({
        id: `hint-${hintLevel}`,
        title: `提示 ${hintLevel}`,
        hintLevel,
        blocks: [{ type: 'paragraph', text: `第 ${hintLevel} 级提示` }],
      })),
    };

    expect(tutorResultSchema.safeParse(hintResult).success).toBe(true);
    expect(
      tutorResultSchema.safeParse({
        ...hintResult,
        steps: hintResult.steps.slice(0, 2),
      }).success,
    ).toBe(false);
    expect(
      tutorResultSchema.safeParse({
        ...solveResult,
        steps: [{ ...solveResult.steps[0], hintLevel: 1 }],
      }).success,
    ).toBe(false);
  });

  it('拒绝超过 100 KiB 的 Tutor JSON', () => {
    expect(
      tutorResultSchema.safeParse({
        ...solveResult,
        steps: [
          {
            ...solveResult.steps[0],
            explanation: 'A'.repeat(MAX_TUTOR_RESULT_BYTES),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('拒绝流程图悬空引用、自环和重复边', () => {
    const invalidFlow = {
      type: 'flow',
      direction: 'LR',
      nodes: [{ id: 'A', label: '开始', shape: 'rectangle', color: 'blue' }],
      edges: [
        { id: 'edge-1', from: 'A', to: 'B', style: 'solid' },
        { id: 'edge-2', from: 'A', to: 'A', style: 'dashed' },
        { id: 'edge-3', from: 'A', to: 'B', style: 'solid' },
      ],
    };

    const result = flowDiagramSchema.safeParse(invalidFlow);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ message }) => message)).toEqual(
        expect.arrayContaining([
          '流程图边必须引用已存在的节点',
          '流程图不允许自环',
          '流程图不允许重复边',
        ]),
      );
    }
  });
});

describe('AI API 契约', () => {
  it('校验普通请求与 Explain step 的父级上下文', () => {
    expect(
      tutorRequestSchema.safeParse({ ...requestBase, mode: 'solve', text: '2x + 3 = 11' }).success,
    ).toBe(true);
    expect(tutorRequestSchema.safeParse({ ...requestBase, mode: 'solve' }).success).toBe(false);
    expect(
      tutorRequestSchema.safeParse({
        ...requestBase,
        mode: 'explain_step',
        text: '为什么要移项？',
      }).success,
    ).toBe(false);
    expect(
      tutorRequestSchema.safeParse({
        ...requestBase,
        mode: 'explain_step',
        text: '为什么要移项？',
        parentTutorBoardId: 'tutor-1',
        targetStepId: 'step-1',
      }).success,
    ).toBe(true);
  });

  it('按解码后字节数限制内联图片', () => {
    const atLimit = 'A'.repeat((MAX_INLINE_IMAGE_BYTES / 3) * 4);
    const overLimit = `${atLimit}AAAA`;
    const imageRequest = {
      ...requestBase,
      mode: 'solve',
      image: { mimeType: 'image/png', base64: atLimit },
    };

    expect(tutorRequestSchema.safeParse(imageRequest).success).toBe(true);
    expect(
      tutorRequestSchema.safeParse({
        ...imageRequest,
        image: { ...imageRequest.image, base64: overLimit },
      }).success,
    ).toBe(false);
  });

  it('固定配额边界和错误码 retryable 语义', () => {
    expect(
      quotaStatusSchema.safeParse({ dailyLimit: 3, remaining: 0, nextAllowedAt: null }).success,
    ).toBe(true);
    expect(
      quotaStatusSchema.safeParse({ dailyLimit: 3, remaining: 4, nextAllowedAt: null }).success,
    ).toBe(false);
    expect(
      apiErrorResponseSchema.safeParse({
        requestId: 'request-1',
        code: 'RATE_LIMITED',
        message: '请求过于频繁',
        retryable: true,
      }).success,
    ).toBe(true);
    expect(
      apiErrorResponseSchema.safeParse({
        requestId: 'request-1',
        code: 'RATE_LIMITED',
        message: '请求过于频繁',
        retryable: false,
      }).success,
    ).toBe(false);
  });
});

describe('持久化契约', () => {
  it('接受 V2 空画板并拒绝不支持的版本', () => {
    expect(parsePersistedCanvas(canvasBase)).toEqual(canvasBase);
    expect(persistedCanvasSchema.safeParse({ ...canvasBase, schemaVersion: 1 }).success).toBe(
      false,
    );
    expect(
      persistedCanvasSchema.safeParse({
        ...canvasBase,
        excalidraw: { ...canvasBase.excalidraw, elements: [{ type: 'script' }] },
      }).success,
    ).toBe(false);
  });

  it('拒绝超过 10 MiB 的画板 JSON', () => {
    expect(
      persistedCanvasSchema.safeParse({
        ...canvasBase,
        excalidraw: {
          ...canvasBase.excalidraw,
          elements: [{ type: 'text', text: 'A'.repeat(MAX_CANVAS_SNAPSHOT_BYTES) }],
        },
      }).success,
    ).toBe(false);
  });

  it('校验单资产和画板资产总容量', () => {
    const makeAsset = (index: number, byteSize = MAX_ASSET_BYTES) => ({
      fileId: `file-${index}`,
      objectPath: `owner/board/hash-${index}`,
      contentHash: index.toString(16).padStart(64, '0'),
      mimeType: 'image/png',
      byteSize,
      width: 1,
      height: 1,
    });
    const atLimit = Array.from({ length: MAX_BOARD_ASSET_BYTES / MAX_ASSET_BYTES }, (_, index) =>
      makeAsset(index),
    );

    expect(persistedCanvasSchema.safeParse({ ...canvasBase, assets: atLimit }).success).toBe(true);
    expect(
      persistedCanvasSchema.safeParse({
        ...canvasBase,
        assets: [...atLimit, makeAsset(atLimit.length, 1)],
      }).success,
    ).toBe(false);
    expect(
      persistedCanvasSchema.safeParse({
        ...canvasBase,
        assets: [makeAsset(0, MAX_ASSET_BYTES + 1)],
      }).success,
    ).toBe(false);
  });

  it('只持久化指向已有步骤的辅导板', () => {
    const tutorBoard = {
      id: 'tutor-1',
      title: '一元一次方程',
      result: solveResult,
      stepIndex: 0,
      sceneAnchor: { sceneX: 120, sceneY: 80 },
      anchorMode: 'follow-source',
      source: {
        elementIds: ['element-1'],
        bounds: { x: 0, y: 0, width: 100, height: 80 },
        contentHash: 'selection-hash',
        relativeOffset: { x: 20, y: 0 },
        status: 'active',
      },
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };

    expect(
      persistedCanvasSchema.safeParse({ ...canvasBase, tutorBoards: [tutorBoard] }).success,
    ).toBe(true);
    expect(
      persistedCanvasSchema.safeParse({
        ...canvasBase,
        tutorBoards: [{ ...tutorBoard, stepIndex: 1 }],
      }).success,
    ).toBe(false);
  });

  it('固定账户删除冷静期为 7 天', () => {
    const deletionRequest = {
      userId: 'user-1',
      requestedAt: '2026-09-22T00:00:00.000Z',
      executeAfter: '2026-09-29T00:00:00.000Z',
      status: 'pending',
      updatedAt: '2026-09-22T00:00:00.000Z',
    };

    expect(accountDeletionRequestSchema.safeParse(deletionRequest).success).toBe(true);
    expect(
      accountDeletionRequestSchema.safeParse({
        ...deletionRequest,
        executeAfter: '2026-09-28T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
