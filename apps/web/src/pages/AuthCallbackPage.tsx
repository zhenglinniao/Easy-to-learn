import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  completeAuthCallback,
  getOptionalSupabaseClient,
  parseSafeRedirect,
} from '../features/auth';
import styles from './pages.module.css';

export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const started = useRef(false);
  const code = params.get('code');
  const providerError = params.get('error');
  const invalidCallback = !getOptionalSupabaseClient() || !code || Boolean(providerError);
  const [error, setError] = useState<string | null>(
    invalidCallback ? '认证回调无效或本地服务尚未配置。' : null,
  );
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const client = getOptionalSupabaseClient();
    const target =
      params.get('flow') === 'recovery'
        ? '/reset-password'
        : parseSafeRedirect(params.get('redirect'));
    if (!client || !code || providerError) return;
    void completeAuthCallback(client, code)
      .then(() => navigate(target, { replace: true }))
      .catch(() => setError('登录链接已过期或已使用，请重新登录。'));
  }, [code, navigate, params, providerError]);
  return (
    <main className={styles.centerPage}>
      <p className={styles.eyebrow}>安全登录</p>
      <h1>{error ? '未能完成登录' : '正在验证身份…'}</h1>
      {error && (
        <>
          <p>{error}</p>
          <Link className={styles.primaryButton} to="/login">
            重新登录
          </Link>
        </>
      )}
    </main>
  );
}
