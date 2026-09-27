import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'easy-to-learn-theme';
export const THEME_EVENT_NAME = 'easy-to-learn-theme-change';

export const readTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // 浏览器隐私设置可能禁用持久化；主题仍应跟随系统并可在当前页面切换。
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const applyTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 存储不可用时仍应用到当前文档，避免一次主题切换导致整页崩溃。
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT_NAME, { detail: theme }));
};

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const update = (event: Event) => {
      const nextTheme = (event as CustomEvent<Theme>).detail;
      setTheme(nextTheme === 'light' || nextTheme === 'dark' ? nextTheme : readTheme());
    };
    window.addEventListener(THEME_EVENT_NAME, update);
    return () => window.removeEventListener(THEME_EVENT_NAME, update);
  }, []);
  return theme;
}
