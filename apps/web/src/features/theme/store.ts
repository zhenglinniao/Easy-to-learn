import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'easy-to-learn-theme';
export const THEME_EVENT_NAME = 'easy-to-learn-theme-change';

export const readTheme = (): Theme => {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const update = () => setTheme(readTheme());
    window.addEventListener(THEME_EVENT_NAME, update);
    return () => window.removeEventListener(THEME_EVENT_NAME, update);
  }, []);
  return theme;
}
