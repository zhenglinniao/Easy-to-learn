import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { scanTextForSecrets } from './secret-scan.mjs';

const maximumTextFileBytes = 2 * 1024 * 1024;

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: process.cwd(),
  encoding: 'buffer',
  maxBuffer: 16 * 1024 * 1024,
})
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const findings = [];

for (const file of trackedFiles) {
  const contents = await readFile(file).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!contents || contents.byteLength > maximumTextFileBytes || contents.includes(0)) continue;

  const text = contents.toString('utf8');
  findings.push(...scanTextForSecrets(file, text));
}

if (findings.length > 0) {
  throw new Error(
    `检测到疑似明文密钥。请移入环境变量并轮换密钥；为安全起见不显示密钥内容：\n${findings.join('\n')}`,
  );
}

console.log(`敏感信息检查通过：已扫描 ${trackedFiles.length} 个 Git 跟踪文件。`);
