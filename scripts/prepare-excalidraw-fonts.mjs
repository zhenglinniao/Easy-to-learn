import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageFonts = resolve(
  repositoryRoot,
  'apps/web/node_modules/@excalidraw/excalidraw/dist/prod/fonts',
);
const publicFonts = resolve(repositoryRoot, 'apps/web/public/fonts');

// 画布字体必须与应用同源发布：生产 CSP 禁止从第三方 CDN 加载字体。
await rm(publicFonts, { recursive: true, force: true });
await mkdir(publicFonts, { recursive: true });
await cp(packageFonts, publicFonts, { recursive: true, force: true });
