import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  completeOAuthCallback,
  getOptionalSupabaseClient,
  parseSafeRedirect,
} from '../features/auth';
import styles from './pages.module.css';

export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invalidCallback = !getOptionalSupabaseClient() || !params.get('code');
  const [error, setError] = useState<string | null>(
    invalidCallback ? '认证回调无效或本地服务尚未配置。' : null,
  );
  useEffect(() => {
    const client = getOptionalSupabaseClient();
    const code = params.get('code');
    const target = parseSafeRedirect(params.get('redirect'));
    if (!client || !code) return;
    void completeOAuthCallback(client, code)
      .then(() => navigate(target, { replace: true }))
      .catch(() => setError('登录链接已过期或已使用，请重新登录。'));
  }, [navigate, params]);
  return (
    <main className={styles.centerPage}>
      <p className={styles.eyebrow}>安全登录</p>
      <h1>{error ? '未能完成登录' : '正在验证身份…'}</h1>
      {error && (
        <>
          <p>{error}</p>
          <Link className={styles.primaryButton} to="/login">
            返回登录
          </Link>
        </>
      )}
    </main>
  );
}
