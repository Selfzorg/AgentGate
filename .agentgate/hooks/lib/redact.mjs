const SECRETISH_KEY = /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|execution[_-]?token|token[_-]?hash|secret|password|passwd|pwd|private[_-]?key|client[_-]?secret)/i;

const TEXT_REDACTIONS = [
  {
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
    replacement: "$1[REDACTED]"
  },
  {
    pattern: /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
    replacement: "[REDACTED_SECRET]"
  },
  {
    pattern: /\b(ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacement: "[REDACTED_SECRET]"
  },
  {
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
    replacement: "[REDACTED_SECRET]"
  },
  {
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    replacement: "[REDACTED_SECRET]"
  },
  {
    pattern: /\b(agentgate[-_a-z0-9]*token[-_.A-Za-z0-9=]{8,})\b/gi,
    replacement: "[REDACTED_EXECUTION_TOKEN]"
  },
  {
    pattern: /\b([a-f0-9]{64})\b/gi,
    replacement: "[REDACTED_HASH]"
  },
  {
    pattern:
      /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|token[_-]?hash|password|authorization)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)([^"',\s}]{4,})(\3)/gi,
    replacement: "$1$2$3[REDACTED]$5"
  }
];

export function isSecretishKey(key) {
  return SECRETISH_KEY.test(String(key));
}

export function redactText(value) {
  if (typeof value !== "string") return value;
  return TEXT_REDACTIONS.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), value);
}

export function redactValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value)) return "[REDACTED_CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isSecretishKey(key) ? "[REDACTED]" : redactValue(child, seen);
  }
  return redacted;
}

export function safeJsonStringify(value) {
  return JSON.stringify(redactValue(value));
}
