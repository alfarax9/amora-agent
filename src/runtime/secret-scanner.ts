// Patterns for credentials that commonly end up pasted into text. Each one is
// specific enough that ordinary prose and code rarely match, because a false
// positive blocks a chat message or hides part of a log line.
const patterns: { name: string; pattern: RegExp }[] = [
  { name: "OpenRouter key", pattern: /sk-or-v1-[A-Za-z0-9]{32,}/g },
  { name: "Anthropic key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI key", pattern: /sk-(?!or-|ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: "Google API key", pattern: /AIza[A-Za-z0-9_-]{35}/g },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "AWS access key", pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g },
  { name: "Telegram bot token", pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { name: "Private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

export type SecretMatch = { name: string; index: number };

export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { name, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      matches.push({ name, index: match.index });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

export function redactSecrets(text: string): string {
  return patterns.reduce(
    (redacted, { name, pattern }) => redacted.replace(pattern, `[redacted ${name}]`),
    text,
  );
}

// Shows only the last four characters (S5), and nothing at all for values so
// short that four characters would give most of them away.
export function maskSecret(secret: string): string {
  return secret.length < 12 ? "••••" : `••••${secret.slice(-4)}`;
}
