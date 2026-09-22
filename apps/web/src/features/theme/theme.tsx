import { THEME_EVENT_NAME, THEME_STORAGE_KEY, useTheme } from './store';

export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      aria-label={`切换到${next === 'dark' ? '深色' : '浅色'}主题`}
      title={`切换到${next === 'dark' ? '深色' : '浅色'}主题`}
      onClick={() => {
        localStorage.setItem(THEME_STORAGE_KEY, next);
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;
        window.dispatchEvent(new Event(THEME_EVENT_NAME));
      }}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}
