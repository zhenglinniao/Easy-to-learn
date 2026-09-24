interface AuthErrorLike {
  code?: string;
  status?: number;
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: '邮箱或密码不正确。',
  email_address_invalid: '请输入可以正常接收邮件的邮箱地址。',
  email_address_not_authorized: '验证邮件服务尚未完成生产配置，请联系支持人员。',
  email_not_confirmed: '请先打开验证邮件完成邮箱确认。',
  weak_password: '密码强度不足，请使用至少 8 位且不易猜测的密码。',
  same_password: '新密码不能与当前密码相同。',
  over_email_send_rate_limit: '邮件发送得太频繁，请稍后再试。',
  over_request_rate_limit: '操作过于频繁，请稍后再试。',
  signup_disabled: '当前暂未开放新用户注册。',
  email_provider_disabled: '邮箱登录当前不可用。',
  oauth_provider_not_supported: '该第三方登录方式尚未启用。',
  provider_disabled: '该第三方登录方式尚未启用。',
  captcha_failed: '安全验证未通过，请刷新页面后重试。',
  flow_state_expired: '登录链接已过期，请重新发起操作。',
  flow_state_not_found: '登录链接已失效，请重新发起操作。',
  bad_code_verifier: '登录验证未完成，请在原浏览器中重新登录。',
  session_not_found: '登录状态已失效，请重新登录。',
  request_timeout: '认证请求超时，请检查网络后重试。',
  unexpected_failure: '认证服务出现异常，请稍后重试；若持续发生请联系支持人员。',
  user_banned: '该账户暂时无法登录，请联系支持人员。',
};

export const toAuthMessage = (
  error: unknown,
  fallback = '认证服务暂时不可用，请稍后重试。',
): string => {
  if (!error || typeof error !== 'object') return fallback;
  const { code, status } = error as AuthErrorLike;
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (status === 429) return '操作过于频繁，请稍后再试。';
  return fallback;
};
