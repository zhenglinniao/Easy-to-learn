import { applyTheme, useTheme } from './store';

export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      aria-label={`切换到${next === 'dark' ? '深色' : '浅色'}主题`}
      title={`切换到${next === 'dark' ? '深色' : '浅色'}主题`}
      onClick={() => applyTheme(next)}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}
