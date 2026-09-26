export const configuredAdminUserIds = (
  environment: Record<string, string | undefined> = process.env,
): Set<string> =>
  new Set(
    (environment.ADMIN_USER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

export const isAdminUserId = (
  userId: string,
  environment: Record<string, string | undefined> = process.env,
): boolean => configuredAdminUserIds(environment).has(userId);
