import type { ApiFault } from './fault.js';

interface ApiErrorLog {
  timestamp: string;
  level: 'warning' | 'error';
  event: 'api_request_failed';
  requestId: string;
  code: ApiFault['code'];
  httpStatus: number;
  retryable: boolean;
}

export const createApiErrorLog = (
  fault: ApiFault,
  requestId: string,
  now: () => Date = () => new Date(),
): ApiErrorLog => ({
  timestamp: now().toISOString(),
  level: fault.httpStatus >= 500 ? 'error' : 'warning',
  event: 'api_request_failed',
  requestId,
  code: fault.code,
  httpStatus: fault.httpStatus,
  retryable: fault.retryable,
});

export const logApiError = (fault: ApiFault, requestId: string): void => {
  const record = createApiErrorLog(fault, requestId);
  const write = record.level === 'error' ? console.error : console.warn;
  write(JSON.stringify(record));
};
