const AGENTGATE_TOKEN_REDACTION = "[REDACTED_AGENTGATE_TOKEN]";
const SECRET_REDACTION = "[REDACTED_SECRET]";
const TOKEN_ID_REDACTION = "[REDACTED_TOKEN_ID]";

export type RedactionInput = {
  value: unknown;
  activeTokenStrings?: string[] | undefined;
};

export function redactForAi(input: RedactionInput): string {
  let text = typeof input.value === "string" ? input.value : JSON.stringify(input.value, null, 2);

  for (const token of input.activeTokenStrings ?? []) {
    if (token.length < 8) continue;
    text = text.split(token).join(AGENTGATE_TOKEN_REDACTION);
  }

  return redactCommonSecrets(text);
}

export function extractTransientExecutionTokens(context: unknown): string[] {
  const found = new Set<string>();
  collectTokens(context, found);
  return [...found];
}

export function redactCommonSecrets(input: string): string {
  return input
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, `$1${SECRET_REDACTION}`)
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, `$1${SECRET_REDACTION}`)
    .replace(/(["']?api[_-]?key["']?\s*[:=]\s*)["']?[^"',}\s]+["']?/gi, `$1"${SECRET_REDACTION}"`)
    .replace(/(["']?password["']?\s*[:=]\s*)["']?[^"',}\s]+["']?/gi, `$1"${SECRET_REDACTION}"`)
    .replace(/(["']?secret["']?\s*[:=]\s*)["']?[^"',}\s]+["']?/gi, `$1"${SECRET_REDACTION}"`)
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*\s*=\s*)[^\s"',}]+/g, `$1${SECRET_REDACTION}`)
    .replace(/\bexec_tok_[A-Za-z0-9_-]+\b/g, TOKEN_ID_REDACTION)
    .replace(/\b[a-f0-9]{64}\b/gi, "[REDACTED_TOKEN_HASH]");
}

function collectTokens(value: unknown, found: Set<string>) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) collectTokens(item, found);
    return;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      typeof item === "string" &&
      item.length >= 8 &&
      (normalized.includes("execution_token") ||
        normalized.includes("active_token") ||
        normalized.includes("raw_token") ||
        normalized === "token")
    ) {
      found.add(item);
    }
    collectTokens(item, found);
  }
}
