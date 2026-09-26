import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AdminApiClient } from '../features/admin/client';
import { useAuth } from '../features/auth';
import { ThemeToggle } from '../features/theme';
import styles from './pages.module.css';

export function SiteHeader() {
  const { user, session, signOut } = useAuth();
  const { pathname } = useLocation();
  const [adminAccess, setAdminAccess] = useState<{ userId: string; allowed: boolean } | null>(null);
  const adminClient = useMemo(
    () => new AdminApiClient(async () => session?.access_token ?? null),
    [session?.access_token],
  );
  useEffect(() => {
    if (!user || !session?.access_token) return;
    const controller = new AbortController();
    void adminClient
      .access(controller.signal)
      .then(({ isAdmin: allowed }) => setAdminAccess({ userId: user.id, allowed }))
      .catch(() => setAdminAccess({ userId: user.id, allowed: false }));
    return () => controller.abort();
  }, [adminClient, session?.access_token, user]);
  const isAdmin = Boolean(user && adminAccess?.userId === user.id && adminAccess.allowed);
  const isAdminMode = pathname.startsWith('/admin');
  return (
    <header className={styles.siteHeader}>
      <Link className={styles.brand} to="/" aria-label="Easy to learn 首页">
        <span aria-hidden="true">E</span>Easy to learn
      </Link>
      <nav aria-label="主导航">
        <ThemeToggle />
        <Link className={styles.navCanvas} to="/canvas">
          打开画布
        </Link>
        {user ? (
          <>
            <Link to="/boards">我的画板</Link>
            {isAdmin && (
              <Link
                className={styles.adminModeSwitch}
                data-active={isAdminMode ? 'true' : 'false'}
                to={isAdminMode ? '/boards' : '/admin'}
                aria-label={isAdminMode ? '退出管理员模式，返回用户端' : '切换到管理员配置'}
                title={isAdminMode ? '返回用户端' : '打开管理员配置'}
              >
                <span aria-hidden="true" />
                {isAdminMode ? '返回用户端' : '管理配置'}
              </Link>
            )}
            <button type="button" onClick={() => void signOut()}>
              退出
            </button>
          </>
        ) : (
          <Link className={styles.navPrimary} to="/login">
            登录保存
          </Link>
        )}
      </nav>
    </header>
  );
}
