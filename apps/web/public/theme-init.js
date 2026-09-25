(() => {
  // Excalidraw 默认会从第三方 CDN 拉取字体；生产环境使用同源字体以符合 CSP。
  globalThis.EXCALIDRAW_ASSET_PATH = '/';

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
