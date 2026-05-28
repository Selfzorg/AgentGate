import { redactValue } from "./redact.mjs";

export class AgentGateUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AgentGateUnavailableError";
    this.cause = options.cause;
    this.status = options.status;
  }
}

export async function postDecision(payload, env = process.env, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new AgentGateUnavailableError("fetch is not available in this Node.js runtime.");
  }

  const baseUrl = env.AGENTGATE_API_BASE_URL ?? "http://localhost:4000";
  const timeoutMs = Number(env.AGENTGATE_HOOK_TIMEOUT_MS ?? 2500);
  const url = new URL("/api/v1/decision", withTrailingSlash(baseUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(redactValue(payload)),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new AgentGateUnavailableError(`AgentGate API returned HTTP ${response.status}.`, {
        status: response.status
      });
    }

    return redactValue(await response.json());
  } catch (error) {
    if (error instanceof AgentGateUnavailableError) throw error;
    throw new AgentGateUnavailableError(`AgentGate API unavailable: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function withTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
