import {
  API_ERROR_DEFINITIONS,
  type ApiErrorCode,
  type ApiErrorResponse,
} from '@easy-to-learn/domain';

export class ApiFault extends Error {
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, string | number | boolean>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiFault';
    this.httpStatus = API_ERROR_DEFINITIONS[code].httpStatus;
    this.retryable = API_ERROR_DEFINITIONS[code].retryable;
  }

  toResponse(requestId: string): ApiErrorResponse {
    return {
      requestId,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export const asApiFault = (error: unknown): ApiFault =>
  error instanceof ApiFault
    ? error
    : new ApiFault('INTERNAL_ERROR', '服务暂时不可用，请稍后重试', undefined, {
        cause: error,
      });
