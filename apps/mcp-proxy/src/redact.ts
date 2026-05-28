const SECRETISH_KEY =
  /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|execution[_-]?token|token[_-]?hash|secret|password|passwd|pwd|private[_-]?key|client[_-]?secret)/i;

const SAFE_TOKEN_METADATA_KEYS = new Set(["execution_token", "execution_token_id", "token_status"]);

const TEXT_REDACTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, replacement: "$1[REDACTED]" },
  { pattern: /\b(sk-[A-Za-z0-9_-]{12,})\b/g, replacement: "[REDACTED_SECRET]" },
  { pattern: /\b(ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, replacement: "[REDACTED_SECRET]" },
  { pattern: /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g, replacement: "[REDACTED_SECRET]" },
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g, replacement: "[REDACTED_SECRET]" },
  {
    pattern: /\b(agentgate[-_a-z0-9]*token[-_.A-Za-z0-9=]{8,})\b/gi,
    replacement: "[REDACTED_EXECUTION_TOKEN]"
  },
  { pattern: /\b([a-f0-9]{64})\b/gi, replacement: "[REDACTED_HASH]" },
  {
    pattern:
      /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|token[_-]?hash|password|authorization)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)([^"',\s}]{4,})(\3)/gi,
    replacement: "$1$2$3[REDACTED]$5"
  }
];

export function redactText(value: string): string {
  return TEXT_REDACTIONS.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), value);
}

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED_CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, isSecretishKey(key) ? "[REDACTED]" : redactValue(entry, seen)])
  );
}

export function redactedJson(value: unknown): string {
  return JSON.stringify(redactValue(value), null, 2);
}

function isSecretishKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/-/g, "_");
  if (SAFE_TOKEN_METADATA_KEYS.has(normalized)) return false;
  return SECRETISH_KEY.test(key);
}
