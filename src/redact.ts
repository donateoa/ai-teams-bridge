const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-ant-[A-Za-z0-9-_]{20,}/g, label: '[REDACTED_ANTHROPIC_KEY]' },
  { re: /sk-proj-[A-Za-z0-9-_]{20,}/g, label: '[REDACTED_OPENAI_KEY]' },
  { re: /\bsk-[A-Za-z0-9]{32,}\b/g, label: '[REDACTED_OPENAI_KEY]' },
  { re: /AKIA[0-9A-Z]{16}/g, label: '[REDACTED_AWS_KEY]' },
  { re: /ASIA[0-9A-Z]{16}/g, label: '[REDACTED_AWS_KEY]' },
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/g, label: '[REDACTED_GITHUB_TOKEN]' },
  { re: /github_pat_[A-Za-z0-9_]{40,}/g, label: '[REDACTED_GITHUB_TOKEN]' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: '[REDACTED_SLACK_TOKEN]' },
  { re: /\b(?:sk|rk|pk|whsec)_(?:live|test)_[A-Za-z0-9]{20,}/g, label: '[REDACTED_STRIPE_KEY]' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: '[REDACTED_JWT]' },
  {
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
    label: '[REDACTED_PRIVATE_KEY]',
  },
  { re: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g, label: '[REDACTED_SSH_KEY]' },
  { re: /AIza[0-9A-Za-z-_]{35}/g, label: '[REDACTED_GOOGLE_KEY]' },
  { re: /\b(?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token)\s*[=:]\s*['"][^'"\n]{8,}['"]/gi, label: '[REDACTED_CREDENTIAL]' },
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, label } of PATTERNS) out = out.replace(re, label);
  return out;
}
