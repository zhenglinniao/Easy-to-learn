interface BoardErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

const hasMessage = (error: BoardErrorLike, value: string): boolean =>
  error.message?.includes(value) ?? false;

export const toBoardMessage = (
  error: unknown,
  fallback = '画板服务暂时不可用，请稍后重试。',
): string => {
  const candidate = (typeof error === 'object' && error !== null ? error : {}) as BoardErrorLike;

  if (hasMessage(candidate, 'STORAGE_QUOTA_EXCEEDED')) {
    return '画板或图片存储已达到上限，请先整理已有内容。';
  }
  if (hasMessage(candidate, 'BOARD_NOT_FOUND') || candidate.code === 'PGRST116') {
    return '这块画板不存在，或你没有访问权限。';
  }
  if (hasMessage(candidate, 'AUTH_REQUIRED') || candidate.status === 401) {
    return '登录状态已失效，请重新登录后再试。';
  }
  if (candidate.status === 429) {
    return '操作过于频繁，请稍后再试。';
  }
  return fallback;
};
