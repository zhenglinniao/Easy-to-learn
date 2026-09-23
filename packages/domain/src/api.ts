import { z } from 'zod';

import { MAX_INLINE_IMAGE_BYTES, TUTOR_SCHEMA_VERSION } from './constants';
import {
  boundsSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  tutorImageMimeTypeSchema,
} from './common';
import { tutorResultSchema, tutorStepSchema } from './tutor';

export const API_ERROR_DEFINITIONS = {
  INVALID_INPUT: { httpStatus: 400, retryable: false },
  INVALID_REDIRECT: { httpStatus: 400, retryable: false },
  AUTH_REQUIRED: { httpStatus: 401, retryable: false },
  INVALID_ANON_SESSION: { httpStatus: 401, retryable: true },
  FORBIDDEN: { httpStatus: 403, retryable: false },
  BOARD_NOT_FOUND: { httpStatus: 404, retryable: false },
  REVISION_CONFLICT: { httpStatus: 409, retryable: false },
  DELETION_ALREADY_STARTED: { httpStatus: 409, retryable: false },
  PAYLOAD_TOO_LARGE: { httpStatus: 413, retryable: false },
  BOARD_TOO_LARGE: { httpStatus: 413, retryable: false },
  UNSUPPORTED_MEDIA_TYPE: { httpStatus: 415, retryable: false },
  INVALID_MODEL_OUTPUT: { httpStatus: 422, retryable: true },
  UNSUPPORTED_SCHEMA: { httpStatus: 422, retryable: false },
  RATE_LIMITED: { httpStatus: 429, retryable: true },
  QUOTA_EXCEEDED: { httpStatus: 429, retryable: false },
  STORAGE_QUOTA_EXCEEDED: { httpStatus: 429, retryable: false },
  AI_PROVIDER_ERROR: { httpStatus: 502, retryable: true },
  DEPENDENCY_UNAVAILABLE: { httpStatus: 503, retryable: true },
  AI_TIMEOUT: { httpStatus: 504, retryable: true },
  INTERNAL_ERROR: { httpStatus: 500, retryable: true },
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_DEFINITIONS;

export const apiErrorCodeSchema = z.enum(
  Object.keys(API_ERROR_DEFINITIONS) as [ApiErrorCode, ...ApiErrorCode[]],
);

const errorDetailValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const apiErrorResponseSchema = z
  .strictObject({
    requestId: nonEmptyStringSchema,
    code: apiErrorCodeSchema,
    message: nonEmptyStringSchema,
    retryable: z.boolean(),
    details: z.record(z.string(), errorDetailValueSchema).optional(),
  })
  .refine(({ code, retryable }) => API_ERROR_DEFINITIONS[code].retryable === retryable, {
    message: 'retryable 必须与错误码定义一致',
    path: ['retryable'],
  });

export const createDataResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.strictObject({ data: dataSchema });

export const quotaStatusSchema = z.strictObject({
  dailyLimit: z.literal(3),
  remaining: nonNegativeIntegerSchema.max(3),
  nextAllowedAt: isoDateTimeSchema.nullable(),
});

const base64Schema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      context.addIssue({ code: 'custom', message: '图片必须使用有效的 Base64' });
      return;
    }
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const decodedBytes = (value.length / 4) * 3 - padding;
    if (decodedBytes > MAX_INLINE_IMAGE_BYTES) {
      context.addIssue({ code: 'custom', message: '内联图片解码后不能超过 1.5 MiB' });
    }
  });

const tutorImageSchema = z
  .strictObject({
    mimeType: tutorImageMimeTypeSchema,
    base64: base64Schema.optional(),
    uploadPath: nonEmptyStringSchema.optional(),
  })
  .refine(({ base64, uploadPath }) => base64 !== undefined || uploadPath !== undefined, {
    message: '图片必须包含 base64 或 uploadPath',
  });

const tutorParentContextSchema = z.strictObject({
  title: z.string().min(1).max(120),
  step: tutorStepSchema,
});

export const tutorRequestSchema = z
  .strictObject({
    requestId: nonEmptyStringSchema,
    schemaVersion: z.literal(TUTOR_SCHEMA_VERSION),
    boardId: nonEmptyStringSchema,
    mode: z.enum(['solve', 'hint', 'explain_step']),
    text: z.string().min(1).max(10_000).optional(),
    image: tutorImageSchema.optional(),
    locale: z.literal('zh-CN'),
    source: z.strictObject({
      elementIds: z.array(nonEmptyStringSchema).min(1).max(500),
      selectionBounds: boundsSchema,
      contentHash: nonEmptyStringSchema,
    }),
    parentTutorBoardId: nonEmptyStringSchema.optional(),
    targetStepId: nonEmptyStringSchema.optional(),
    parentContext: tutorParentContextSchema.optional(),
  })
  .superRefine(
    ({ text, image, mode, parentTutorBoardId, targetStepId, parentContext }, context) => {
      if (text === undefined && image === undefined) {
        context.addIssue({ code: 'custom', path: ['text'], message: '文字和图片至少提供一项' });
      }

      const hasExplainContext =
        parentTutorBoardId !== undefined &&
        targetStepId !== undefined &&
        parentContext !== undefined;
      if (mode === 'explain_step' && !hasExplainContext) {
        context.addIssue({
          code: 'custom',
          path: ['parentTutorBoardId'],
          message: 'Explain step 必须提供父辅导板和目标步骤',
        });
      }
      if (
        mode !== 'explain_step' &&
        (parentTutorBoardId !== undefined ||
          targetStepId !== undefined ||
          parentContext !== undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['parentTutorBoardId'],
          message: '只有 Explain step 可以携带父辅导板和目标步骤',
        });
      }
    },
  );

export const tutorResponseSchema = createDataResponseSchema(
  z.strictObject({
    requestId: nonEmptyStringSchema,
    result: tutorResultSchema,
    quota: z.strictObject({
      dailyLimit: z.literal(3),
      remaining: nonNegativeIntegerSchema.max(3),
      nextAllowedAt: isoDateTimeSchema,
    }),
  }),
);

export const aiFeedbackCategorySchema = z.enum([
  'incorrect_answer',
  'unclear_explanation',
  'unsafe_content',
  'other',
]);

export const aiFeedbackInputSchema = z.strictObject({
  requestId: z.uuid(),
  rating: z.union([z.literal(-1), z.literal(1)]),
  category: aiFeedbackCategorySchema.optional(),
});

export const anonymousSessionResponseSchema = createDataResponseSchema(
  z.strictObject({ expiresAt: isoDateTimeSchema, quota: quotaStatusSchema }),
);

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type QuotaStatus = z.infer<typeof quotaStatusSchema>;
export type TutorRequest = z.infer<typeof tutorRequestSchema>;
export type TutorResponse = z.infer<typeof tutorResponseSchema>;
export type AiFeedbackCategory = z.infer<typeof aiFeedbackCategorySchema>;
export type AiFeedbackInput = z.infer<typeof aiFeedbackInputSchema>;
export type AnonymousSessionResponse = z.infer<typeof anonymousSessionResponseSchema>;
