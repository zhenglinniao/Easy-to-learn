import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth';
import styles from './pages.module.css';

export default function ResetPasswordPage() {
  const { loading, user, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <p className="route-loading">正在验证重置链接…</p>;
  if (!user) {
    return (
      <main className={styles.centerPage}>
        <p className={styles.eyebrow}>重置密码</p>
        <h1>链接已失效</h1>
        <p>请重新申请密码重置邮件，并在同一浏览器中打开最新链接。</p>
        <Link className={styles.primaryButton} to="/login">
          返回登录
        </Link>
      </main>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) {
      setError('两次输入的密码不一致。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      await signOut();
      navigate('/login?message=password-updated', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '密码更新失败，请重新申请重置邮件。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.centerPage}>
      <section className={styles.passwordCard} aria-labelledby="reset-password-title">
        <p className={styles.eyebrow}>账户安全</p>
        <h1 id="reset-password-title">设置新密码</h1>
        <p>使用至少 8 位且未在其他网站重复使用的密码。</p>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <input
              className={styles.visuallyHidden}
              type="email"
              name="username"
              autoComplete="username"
              value={user.email ?? ''}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
            />
            <label htmlFor="new-password">
              新密码
              <input
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label htmlFor="new-password-confirmation">
              确认新密码
              <input
                id="new-password-confirmation"
                name="newPasswordConfirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button className={styles.primaryButton} type="submit">
              {busy ? '正在更新…' : '更新密码'}
            </button>
          </fieldset>
        </form>
        {error && (
          <p className={styles.formMessage} role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
