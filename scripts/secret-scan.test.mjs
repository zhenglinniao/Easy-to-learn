import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scanTextForSecrets } from './secret-scan.mjs';

test('detects supported credential families without echoing their values', () => {
  const values = [
    'sk-' + 'a'.repeat(24),
    'ghp_' + 'b'.repeat(30),
    'AKIA' + 'C'.repeat(16),
    'xoxb-' + 'd'.repeat(24),
    'AI' + 'za' + 'e'.repeat(35),
    'sb_' + 'secret_' + 'f'.repeat(24),
    '-----BEGIN ' + 'PRIVATE KEY-----',
  ];
  const text = values.join('\n');
  const findings = scanTextForSecrets('fixture.txt', text);

  assert.equal(findings.length, values.length);
  for (const value of values) assert.equal(findings.join('\n').includes(value), false);
});

test('ignores documentation placeholders and ordinary identifiers', () => {
  assert.deepEqual(
    scanTextForSecrets('example.env', 'API_KEY=sk-your-key\nSUPABASE_SERVICE_ROLE_KEY=replace-me'),
    [],
  );
});
