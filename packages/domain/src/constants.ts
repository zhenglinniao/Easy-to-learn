export const PERSISTED_CANVAS_SCHEMA_VERSION = 2 as const;
export const TUTOR_SCHEMA_VERSION = 1 as const;
export const DAILY_AI_REQUEST_LIMIT = 3 as const;

export const MEBIBYTE = 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 1.5 * MEBIBYTE;
export const MAX_ASSET_BYTES = 10 * MEBIBYTE;
export const MAX_BOARD_ASSET_BYTES = 100 * MEBIBYTE;
export const MAX_CANVAS_SNAPSHOT_BYTES = 10 * MEBIBYTE;
export const MAX_TUTOR_RESULT_BYTES = 100 * 1024;
export const MAX_IMAGE_EDGE = 8192;
export const MAX_IMAGE_PIXELS = 32_000_000;
