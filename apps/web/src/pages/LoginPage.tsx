import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isSupabaseConfigured, parseSafeRedirect, useAuth } from '../features/auth';
import { SiteHeader } from './SiteHeader';
import styles from './pages.module.css';

export default function LoginPage() {
  const { user, signIn, signUp, signInWithOAuth } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const target = parseSafeRedirect(params.get('redirect'));
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={target} replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        navigate(target, { replace: true });
      } else {
        await signUp(email, password);
        setError('注册邮件已发送，请按邮件提示完成验证。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '认证失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };
  const configured = isSupabaseConfigured();
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
          <div className={styles.authTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => setMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => setMode('register')}
            >
              注册
            </button>
          </div>
          {!configured && (
            <p className={styles.configNotice}>
              本地尚未配置 Supabase。界面可预览，真实登录暂不可用。
            </p>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <label>
              邮箱
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className={styles.primaryButton} type="submit" disabled={busy || !configured}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账户'}
            </button>
          </form>
          <div className={styles.divider}>
            <span>或使用</span>
          </div>
          <div className={styles.oauth}>
            <button
              type="button"
              disabled={!configured}
              onClick={() => void signInWithOAuth('google', target)}
            >
              Google
            </button>
            <button
              type="button"
              disabled={!configured}
              onClick={() => void signInWithOAuth('github', target)}
            >
              GitHub
            </button>
          </div>
          {error && (
            <p className={styles.formMessage} role="status">
              {error}
            </p>
          )}
          <small>
            注册即表示你已获得监护人同意（如当地法律要求），并同意仅将内容用于提供当前服务。
          </small>
        </div>
      </section>
    </main>
  );
}
