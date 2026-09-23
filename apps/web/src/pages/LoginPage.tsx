import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  isOAuthProviderEnabled,
  isSupabaseConfigured,
  parseSafeRedirect,
  useAuth,
} from '../features/auth';
import { SiteHeader } from './SiteHeader';
import styles from './pages.module.css';

type AuthMode = 'login' | 'register' | 'recover';

export default function LoginPage() {
  const {
    initializationError,
    user,
    signIn,
    signUp,
    requestPasswordReset,
    resendSignUpConfirmation,
    signInWithOAuth,
  } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const target = parseSafeRedirect(params.get('redirect'));
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(
    params.get('message') === 'password-updated' ? '密码已更新，请使用新密码登录。' : null,
  );
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();
  const googleEnabled = isOAuthProviderEnabled('google');
  const githubEnabled = isOAuthProviderEnabled('github');

  if (user) return <Navigate to={target} replace />;

  const selectMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setSuccess(null);
    setPendingEmail(null);
    setPassword('');
    setPasswordConfirmation('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === 'recover') {
        await requestPasswordReset(email);
        setSuccess('如果该邮箱已注册，我们会发送重置密码邮件。请检查收件箱和垃圾邮件。');
        return;
      }
      if (mode === 'login') {
        await signIn(email, password);
        navigate(target, { replace: true });
        return;
      }
      if (password !== passwordConfirmation) throw new Error('两次输入的密码不一致。');
      if (!acceptedTerms) throw new Error('请先阅读并同意使用条款与隐私政策。');
      const result = await signUp(email, password, target);
      if (result.requiresEmailConfirmation) {
        setPendingEmail(email.trim().toLowerCase());
        setSuccess('验证邮件已发送。请在同一浏览器打开邮件中的链接完成注册。');
      } else {
        navigate(target, { replace: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '认证失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (provider: 'google' | 'github') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await signInWithOAuth(provider, target);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '第三方登录暂时不可用。');
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!pendingEmail || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resendSignUpConfirmation(pendingEmail, target);
      setSuccess('新的验证邮件已发送，请以最新一封邮件为准。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法重新发送验证邮件。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <SiteHeader />
      <section className={styles.authLayout}>
        <div className={styles.authIntro}>
          <p className={styles.eyebrow}>保存你的思考</p>
          <h1>
            下一次打开，
            <br />
            从这里继续。
          </h1>
          <p>登录后，画板、图片与辅导步骤会安全保存到你的私有空间。</p>
        </div>
        <div className={styles.authCard}>
          {mode !== 'recover' ? (
            <div className={styles.authTabs} role="tablist" aria-label="登录或注册">
              <button
                id="login-tab"
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                aria-controls="auth-panel"
                onClick={() => selectMode('login')}
              >
                登录
              </button>
              <button
                id="register-tab"
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                aria-controls="auth-panel"
                onClick={() => selectMode('register')}
              >
                注册
              </button>
            </div>
          ) : (
            <div className={styles.authHeading}>
              <p className={styles.eyebrow}>找回账户</p>
              <h2>重置密码</h2>
              <p>输入注册邮箱，我们会发送一封安全链接。</p>
            </div>
          )}
          {!configured && (
            <p className={styles.configNotice} role="status">
              本地尚未配置 Supabase。界面可预览，真实登录暂不可用。
            </p>
          )}
          {initializationError && (
            <p className={styles.formMessage} role="alert">
              {initializationError}
            </p>
          )}
          <form
            id="auth-panel"
            role={mode === 'recover' ? undefined : 'tabpanel'}
            aria-labelledby={
              mode === 'recover' ? undefined : mode === 'register' ? 'register-tab' : 'login-tab'
            }
            onSubmit={(event) => void submit(event)}
          >
            <fieldset disabled={busy || !configured}>
              <label htmlFor="auth-email">
                邮箱
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete={mode === 'recover' ? 'email' : 'username'}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              {mode !== 'recover' && (
                <label htmlFor="auth-password">
                  密码
                  <input
                    id="auth-password"
                    name="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-describedby={mode === 'register' ? 'password-hint' : undefined}
                  />
                  {mode === 'register' && (
                    <span id="password-hint" className={styles.fieldHint}>
                      至少 8 位，建议混合大小写字母、数字和符号。
                    </span>
                  )}
                </label>
              )}
              {mode === 'register' && (
                <>
                  <label htmlFor="auth-password-confirmation">
                    确认密码
                    <input
                      id="auth-password-confirmation"
                      name="passwordConfirmation"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={passwordConfirmation}
                      onChange={(event) => setPasswordConfirmation(event.target.value)}
                    />
                  </label>
                  <label className={styles.consentRow}>
                    <input
                      type="checkbox"
                      name="acceptedTerms"
                      required
                      checked={acceptedTerms}
                      onChange={(event) => setAcceptedTerms(event.target.checked)}
                    />
                    <span>
                      我已阅读并同意{' '}
                      <Link to="/terms" target="_blank" rel="noreferrer">
                        使用条款
                      </Link>{' '}
                      与{' '}
                      <Link to="/privacy" target="_blank" rel="noreferrer">
                        隐私政策
                      </Link>
                      ，并已获得监护人同意（如当地法律要求）。
                    </span>
                  </label>
                </>
              )}
              <button className={styles.primaryButton} type="submit">
                {busy
                  ? '请稍候…'
                  : mode === 'login'
                    ? '登录'
                    : mode === 'register'
                      ? '创建账户'
                      : '发送重置邮件'}
              </button>
            </fieldset>
          </form>
          {mode === 'login' && (
            <button
              className={styles.textButton}
              type="button"
              onClick={() => selectMode('recover')}
            >
              忘记密码？
            </button>
          )}
          {mode === 'recover' && (
            <button className={styles.textButton} type="button" onClick={() => selectMode('login')}>
              返回登录
            </button>
          )}
          {(googleEnabled || githubEnabled) && mode !== 'recover' && (
            <>
              <div className={styles.divider}>
                <span>或使用</span>
              </div>
              <div className={styles.oauth}>
                {googleEnabled && (
                  <button
                    type="button"
                    disabled={busy || !configured}
                    onClick={() => void oauth('google')}
                  >
                    Google
                  </button>
                )}
                {githubEnabled && (
                  <button
                    type="button"
                    disabled={busy || !configured}
                    onClick={() => void oauth('github')}
                  >
                    GitHub
                  </button>
                )}
              </div>
            </>
          )}
          <div className={styles.authFeedback} aria-live="polite">
            {error && (
              <p className={styles.formMessage} role="alert">
                {error}
              </p>
            )}
            {success && <p className={styles.successMessage}>{success}</p>}
            {pendingEmail && (
              <button
                className={styles.textButton}
                type="button"
                disabled={busy}
                onClick={() => void resend()}
              >
                没收到邮件？重新发送
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
