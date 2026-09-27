export type LocalPersistenceErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'DATABASE_CORRUPTED'
  | 'MIGRATION_FAILED'
  | 'MISSING_ASSET'
  | 'ASSET_INTEGRITY_FAILED'
  | 'LOCAL_WRITE_FAILED';

export class LocalPersistenceError extends Error {
  readonly blocksCloudWrites = true;

  constructor(
    readonly code: LocalPersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LocalPersistenceError';
  }
}

export class RevisionConflictError extends Error {
  constructor(readonly remoteRevision: number) {
    super('远端画板版本已变化');
    this.name = 'RevisionConflictError';
  }
}

export const toLocalPersistenceError = (error: unknown): LocalPersistenceError => {
  if (error instanceof LocalPersistenceError) return error;
  const cause = error instanceof Error ? error : undefined;
  // 部分浏览器的 DOMException 不继承 Error，但仍通过 name 标识 IndexedDB 故障。
  const name =
    cause?.name ??
    (typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
      ? error.name
      : '');
  if (name === 'QuotaExceededError') {
    return new LocalPersistenceError('QUOTA_EXCEEDED', '本地存储空间不足', { cause });
  }
  if (name === 'VersionError' || name === 'InvalidStateError') {
    return new LocalPersistenceError('DATABASE_CORRUPTED', '本地数据库不可用', { cause });
  }
  return new LocalPersistenceError('LOCAL_WRITE_FAILED', '本地数据写入失败', { cause });
};
