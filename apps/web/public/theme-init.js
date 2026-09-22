(() => {
  const key = 'easy-to-learn-theme';
  const stored = globalThis.localStorage.getItem(key);
  const theme =
    stored === 'light' || stored === 'dark'
      ? stored
      : globalThis.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  globalThis.document.documentElement.dataset.theme = theme;
  globalThis.document.documentElement.style.colorScheme = theme;
})();
