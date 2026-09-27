import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const distDirectory = join(process.cwd(), 'apps', 'web', 'dist');
const htmlPath = join(distDirectory, 'index.html');

const budgets = {
  entryScriptGzipBytes: 100 * 1024,
  entryStyleGzipBytes: 8 * 1024,
  initialAssetsGzipBytes: 115 * 1024,
  canvasRouteScriptGzipBytes: 380 * 1024,
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

const builtAssetNames = await readdir(join(distDirectory, 'assets'));
const routeAsset = async (pattern, label) => {
  const matches = builtAssetNames.filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`${label} 构建产物应当恰好有一个，实际找到 ${matches.length} 个。`);
  }
  const path = `/assets/${matches[0]}`;
  const contents = await readFile(join(distDirectory, path.replace(/^\//, '')));
  return { path, gzipBytes: gzipSync(contents).byteLength };
};
const [canvasRouteScript, canvasRouteStyle] = await Promise.all([
  routeAsset(/^CanvasPage-.*\.js$/, '画板路由 JavaScript'),
  routeAsset(/^CanvasPage-.*\.css$/, '画板路由 CSS'),
]);

const entryScripts = assets.filter(({ path }) => path.endsWith('.js'));
const entryStyles = assets.filter(({ path }) => path.endsWith('.css'));
const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);

const entryScriptGzipBytes = sum(entryScripts, 'gzipBytes');
const entryStyleGzipBytes = sum(entryStyles, 'gzipBytes');
const initialAssetsGzipBytes = sum(assets, 'gzipBytes');

const measurements = [
  ['首屏 JavaScript', entryScriptGzipBytes, budgets.entryScriptGzipBytes],
  ['首屏 CSS', entryStyleGzipBytes, budgets.entryStyleGzipBytes],
  ['首屏资源合计', initialAssetsGzipBytes, budgets.initialAssetsGzipBytes],
  ['画板路由 JavaScript', canvasRouteScript.gzipBytes, budgets.canvasRouteScriptGzipBytes],
  ['画板路由 CSS', canvasRouteStyle.gzipBytes, budgets.canvasRouteStyleGzipBytes],
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
