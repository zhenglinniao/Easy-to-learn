import { z } from 'zod';

import { tutorRequestSchema } from './api';
import { persistedCanvasSchema } from './canvas';
import { tutorResultSchema } from './tutor';

const jsonSchemaOptions = {
  target: 'draft-2020-12',
  unrepresentable: 'any',
} as const;

export const domainJsonSchemas = {
  persistedCanvasV2: z.toJSONSchema(persistedCanvasSchema, jsonSchemaOptions),
  tutorRequestV1: z.toJSONSchema(tutorRequestSchema, jsonSchemaOptions),
  tutorResultV1: z.toJSONSchema(tutorResultSchema, jsonSchemaOptions),
} as const;
