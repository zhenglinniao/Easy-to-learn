import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const maximumTextFileBytes = 2 * 1024 * 1024;
const secretPatterns = [
  { label: 'API key', expression: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { label: 'AWS access key', expression: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'Slack token', expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
];

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
  for (const { label, expression } of secretPatterns) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line} (${label})`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(
    `检测到疑似明文密钥。请移入环境变量并轮换密钥；为安全起见不显示密钥内容：\n${findings.join('\n')}`,
  );
}

console.log(`敏感信息检查通过：已扫描 ${trackedFiles.length} 个 Git 跟踪文件。`);
