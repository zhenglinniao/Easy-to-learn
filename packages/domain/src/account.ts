import { z } from 'zod';

import { isoDateTimeSchema, nonEmptyStringSchema } from './common';

export const accountDeletionStatusSchema = z.enum([
  'pending',
  'cancelled',
  'executing',
  'completed',
  'failed',
]);

export const accountDeletionRequestSchema = z
  .strictObject({
    userId: nonEmptyStringSchema,
    requestedAt: isoDateTimeSchema,
    executeAfter: isoDateTimeSchema,
    status: accountDeletionStatusSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine(
    ({ requestedAt, executeAfter }) =>
      Date.parse(executeAfter) - Date.parse(requestedAt) === 7 * 24 * 60 * 60 * 1_000,
    { message: '账户删除执行时间必须为请求后的 7 天', path: ['executeAfter'] },
  );

export const accountDeletionResponseSchema = z.strictObject({
  data: z.strictObject({ executeAfter: isoDateTimeSchema }),
});

export type AccountDeletionStatus = z.infer<typeof accountDeletionStatusSchema>;
export type AccountDeletionRequest = z.infer<typeof accountDeletionRequestSchema>;
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;
