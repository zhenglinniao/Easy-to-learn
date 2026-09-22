import { z } from 'zod';

export const nonEmptyStringSchema = z.string().min(1);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const finiteNumberSchema = z.number().finite();
export const nonNegativeIntegerSchema = z.number().int().nonnegative();
export const positiveIntegerSchema = z.number().int().positive();

export const boundsSchema = z.strictObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema.nonnegative(),
  height: finiteNumberSchema.nonnegative(),
});

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const supportedImageMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export const tutorImageMimeTypeSchema = z.enum(['image/png', 'image/jpeg']);

export const utf8ByteLength = (value: string): number => {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
};

export const serializedUtf8ByteLength = (value: unknown): number | null => {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : utf8ByteLength(serialized);
  } catch {
    return null;
  }
};

export type Bounds = z.infer<typeof boundsSchema>;
