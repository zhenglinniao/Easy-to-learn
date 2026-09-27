import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const distDirectory = join(process.cwd(), 'apps', 'web', 'dist');
const htmlPath = join(distDirectory, 'index.html');
const manifestPath = join(distDirectory, '.vite', 'manifest.json');

const budgets = {
  entryScriptGzipBytes: 100 * 1024,
  entryStyleGzipBytes: 8 * 1024,
  initialAssetsGzipBytes: 115 * 1024,
  canvasRouteScriptGzipBytes: 430 * 1024,
  canvasRouteStyleGzipBytes: 32 * 1024,
};

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const html = await readFile(htmlPath, 'utf8').catch((error) => {
  throw new Error(`找不到 Web 构建产物，请先运行 pnpm build。\n${error.message}`);
});

const assetPaths = [
  ...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="(\/assets\/[^"]+)"/g),
].map((match) => match[1]);

if (assetPaths.length === 0) {
  throw new Error('index.html 没有可检查的首屏资源。');
}

const assets = await Promise.all(
  assetPaths.map(async (assetPath) => {
    const absolutePath = join(distDirectory, assetPath.replace(/^\//, ''));
    const [contents, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    return {
      path: assetPath,
      rawBytes: metadata.size,
      gzipBytes: gzipSync(contents).byteLength,
    };
  }),
);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const canvasEntryKey = Object.keys(manifest).find((key) => key.endsWith('/CanvasPage.tsx'));
if (!canvasEntryKey || !manifest['index.html']) {
  throw new Error('Vite manifest 缺少首页或画板路由入口。');
}

const collectSynchronousEntries = (entryKey, collected = new Set()) => {
  if (collected.has(entryKey)) return collected;
  const entry = manifest[entryKey];
  if (!entry) throw new Error(`Vite manifest 引用了不存在的入口：${entryKey}`);
  collected.add(entryKey);
  for (const importedKey of entry.imports ?? []) {
    collectSynchronousEntries(importedKey, collected);
  }
  return collected;
};

const initialEntryKeys = collectSynchronousEntries('index.html');
const canvasEntryKeys = collectSynchronousEntries(canvasEntryKey);
const incrementalCanvasKeys = [...canvasEntryKeys].filter((key) => !initialEntryKeys.has(key));
const canvasScriptPaths = new Set();
const canvasStylePaths = new Set();
for (const key of incrementalCanvasKeys) {
  const entry = manifest[key];
  if (entry.file?.endsWith('.js')) canvasScriptPaths.add(entry.file);
  for (const style of entry.css ?? []) canvasStylePaths.add(style);
}

const gzipBuiltFiles = async (paths) =>
  Promise.all(
    [...paths].map(async (path) => gzipSync(await readFile(join(distDirectory, path))).byteLength),
  );
const [canvasScriptSizes, canvasStyleSizes] = await Promise.all([
  gzipBuiltFiles(canvasScriptPaths),
  gzipBuiltFiles(canvasStylePaths),
]);

const entryScripts = assets.filter(({ path }) => path.endsWith('.js'));
const entryStyles = assets.filter(({ path }) => path.endsWith('.css'));
const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);

const entryScriptGzipBytes = sum(entryScripts, 'gzipBytes');
const entryStyleGzipBytes = sum(entryStyles, 'gzipBytes');
const initialAssetsGzipBytes = sum(assets, 'gzipBytes');
const canvasRouteScriptGzipBytes = canvasScriptSizes.reduce((total, size) => total + size, 0);
const canvasRouteStyleGzipBytes = canvasStyleSizes.reduce((total, size) => total + size, 0);

const measurements = [
  ['首屏 JavaScript', entryScriptGzipBytes, budgets.entryScriptGzipBytes],
  ['首屏 CSS', entryStyleGzipBytes, budgets.entryStyleGzipBytes],
  ['首屏资源合计', initialAssetsGzipBytes, budgets.initialAssetsGzipBytes],
  ['画板路由同步 JavaScript', canvasRouteScriptGzipBytes, budgets.canvasRouteScriptGzipBytes],
  ['画板路由同步 CSS', canvasRouteStyleGzipBytes, budgets.canvasRouteStyleGzipBytes],
];

for (const asset of assets) {
  console.log(
    `${asset.path}: ${formatKiB(asset.gzipBytes)} gzip (${formatKiB(asset.rawBytes)} raw)`,
  );
}

const exceeded = measurements.filter(([, actual, budget]) => actual > budget);
for (const [label, actual, budget] of measurements) {
  console.log(`${label}: ${formatKiB(actual)} / ${formatKiB(budget)}`);
}

if (exceeded.length > 0) {
  const details = exceeded
    .map(([label, actual, budget]) => `${label} 超出 ${formatKiB(actual - budget)}`)
    .join('；');
  throw new Error(`Web 体积预算检查失败：${details}`);
}

console.log('Web 体积预算检查通过。');
