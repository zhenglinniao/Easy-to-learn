import { z } from 'zod';

import { tutorRequestSchema } from './api.js';
import { persistedCanvasSchema } from './canvas.js';
import { tutorResultSchema } from './tutor.js';

const jsonSchemaOptions = {
  target: 'draft-2020-12',
  unrepresentable: 'any',
} as const;

export const domainJsonSchemas = {
  persistedCanvasV2: z.toJSONSchema(persistedCanvasSchema, jsonSchemaOptions),
  tutorRequestV1: z.toJSONSchema(tutorRequestSchema, jsonSchemaOptions),
  tutorResultV1: z.toJSONSchema(tutorResultSchema, jsonSchemaOptions),
} as const;
