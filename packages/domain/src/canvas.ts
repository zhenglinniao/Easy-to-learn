import { z } from 'zod';

import {
  MAX_ASSET_BYTES,
  MAX_BOARD_ASSET_BYTES,
  MAX_CANVAS_SNAPSHOT_BYTES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  PERSISTED_CANVAS_SCHEMA_VERSION,
} from './constants';
import {
  boundsSchema,
  finiteNumberSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  sha256Schema,
  serializedUtf8ByteLength,
  supportedImageMimeTypeSchema,
} from './common';
import { tutorResultSchema } from './tutor';

export const excalidrawElementTypeSchema = z.enum([
  'rectangle',
  'diamond',
  'ellipse',
  'text',
  'image',
  'line',
  'arrow',
  'freedraw',
  'frame',
  'magicframe',
  'iframe',
  'embeddable',
]);

// Excalidraw 自己负责内部字段恢复；领域层只固定 SDK 的元素类型边界并保留原始字段。
export const persistedExcalidrawElementSchema = z.looseObject({
  type: excalidrawElementTypeSchema,
});

export const persistedAppStateSchema = z.strictObject({
  viewBackgroundColor: nonEmptyStringSchema,
  gridSize: positiveIntegerSchema.nullable(),
  gridStep: positiveIntegerSchema,
  gridModeEnabled: z.boolean(),
  objectsSnapModeEnabled: z.boolean(),
});

export const assetManifestItemSchema = z
  .strictObject({
    fileId: z.string().min(1).max(100),
    objectPath: nonEmptyStringSchema,
    contentHash: sha256Schema,
    mimeType: supportedImageMimeTypeSchema,
    byteSize: positiveIntegerSchema.max(MAX_ASSET_BYTES),
    width: positiveIntegerSchema.max(MAX_IMAGE_EDGE),
    height: positiveIntegerSchema.max(MAX_IMAGE_EDGE),
  })
  .refine(({ width, height }) => width * height <= MAX_IMAGE_PIXELS, {
    message: '图片总像素不能超过 32 MP',
    path: ['width'],
  });

export const persistedTutorBoardSchema = z
  .strictObject({
    id: nonEmptyStringSchema,
    title: z.string().min(1).max(120),
    result: tutorResultSchema,
    stepIndex: nonNegativeIntegerSchema,
    sceneAnchor: z.strictObject({
      sceneX: finiteNumberSchema,
      sceneY: finiteNumberSchema,
    }),
    anchorMode: z.enum(['absolute', 'follow-source']),
    source: z.strictObject({
      elementIds: z.array(nonEmptyStringSchema),
      bounds: boundsSchema,
      contentHash: nonEmptyStringSchema,
      relativeOffset: z.strictObject({ x: finiteNumberSchema, y: finiteNumberSchema }).optional(),
      status: z.enum(['active', 'stale', 'orphaned']),
    }),
    parentTutorBoardId: nonEmptyStringSchema.optional(),
    targetStepId: nonEmptyStringSchema.optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine(({ stepIndex, result }) => stepIndex < result.steps.length, {
    message: 'stepIndex 必须指向已有步骤',
    path: ['stepIndex'],
  });

export const persistedCanvasSchema = z
  .strictObject({
    schemaVersion: z.literal(PERSISTED_CANVAS_SCHEMA_VERSION),
    boardId: nonEmptyStringSchema,
    revision: nonNegativeIntegerSchema,
    excalidraw: z.strictObject({
      elements: z.array(persistedExcalidrawElementSchema),
      appState: persistedAppStateSchema,
    }),
    assets: z.array(assetManifestItemSchema),
    tutorBoards: z.array(persistedTutorBoardSchema),
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((snapshot, context) => {
    const { assets } = snapshot;
    const snapshotBytes = serializedUtf8ByteLength(snapshot);
    if (snapshotBytes === null || snapshotBytes > MAX_CANVAS_SNAPSHOT_BYTES) {
      context.addIssue({ code: 'custom', message: '画板快照 JSON 超过 10 MiB' });
    }

    const totalBytes = assets.reduce((sum, asset) => sum + asset.byteSize, 0);
    if (totalBytes > MAX_BOARD_ASSET_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: '单个画板资产总量不能超过 100 MiB',
      });
    }

    const fileIds = new Set<string>();
    const contentHashes = new Set<string>();
    assets.forEach((asset, index) => {
      if (fileIds.has(asset.fileId) || contentHashes.has(asset.contentHash)) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index],
          message: '画板资产的 fileId 和 contentHash 必须唯一',
        });
      }
      fileIds.add(asset.fileId);
      contentHashes.add(asset.contentHash);
    });
  });

export const parsePersistedCanvas = (input: unknown): PersistedCanvasV2 => {
  const byteLength = serializedUtf8ByteLength(input);
  if (byteLength === null || byteLength > MAX_CANVAS_SNAPSHOT_BYTES) {
    throw new Error('画板快照 JSON 超过 10 MiB');
  }
  return persistedCanvasSchema.parse(input);
};

export type PersistedAppState = z.infer<typeof persistedAppStateSchema>;
export type AssetManifestItem = z.infer<typeof assetManifestItemSchema>;
export type PersistedTutorBoardV2 = z.infer<typeof persistedTutorBoardSchema>;
export type PersistedCanvasV2 = z.infer<typeof persistedCanvasSchema>;
