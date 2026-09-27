export const secretPatterns = [
  { label: 'API key', expression: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { label: 'AWS access key', expression: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'Slack token', expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { label: 'Google API key', expression: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'Supabase secret key', expression: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
  {
    label: 'Private key',
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
];

export const scanTextForSecrets = (file, text) => {
  const findings = [];
  for (const { label, expression } of secretPatterns) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line} (${label})`);
    }
  }
  return findings;
};
