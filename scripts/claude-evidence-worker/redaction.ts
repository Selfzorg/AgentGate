const secretKeyPattern = /(token|secret|password|api.?key|authorization|token.?hash|hash)/i;

export function redactString(value: string): string {
  return String(redactValue(value));
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return redactStringPattern(value);
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      secretKeyPattern.test(key) ? "[REDACTED]" : redactValue(entry)
    ])
  );
}

function redactStringPattern(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]{16,}/g, "[REDACTED]")
    .replace(/((?:token|secret|password|api[_-]?key)=)([^&\s]+)/gi, "$1[REDACTED]");
}
