import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth';
import { ThemeToggle } from '../features/theme';
import styles from './pages.module.css';

export function SiteHeader() {
  const { user, signOut } = useAuth();
  return (
    <header className={styles.siteHeader}>
      <Link className={styles.brand} to="/" aria-label="Easy to learn 首页">
        <span aria-hidden="true">E</span>Easy to learn
      </Link>
      <nav aria-label="主导航">
        <ThemeToggle />
        <Link to="/canvas">打开画布</Link>
        {user ? (
          <>
            <Link to="/boards">我的画板</Link>
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
