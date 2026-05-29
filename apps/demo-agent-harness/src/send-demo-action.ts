import type { NormalizedActionRequest } from "@agentgate/core-types";

export type DemoHarnessOptions = {
  apiBaseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
};

export async function sendDemoAction(request: NormalizedActionRequest, options: DemoHarnessOptions = {}) {
  const response = await requestJson(options, "/api/v1/decision", request);
  return response as {
    decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
    skill_id: string;
    trace_id: string;
    run_id: string;
    mode: "observe" | "warn" | "enforce";
  };
}

export async function requestJson(options: DemoHarnessOptions, path: string, body?: unknown) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is not available in this runtime.");

  const requestInit: RequestInit = {
    method: body === undefined ? "GET" : "POST"
  };
  if (body !== undefined) {
    requestInit.headers = { "content-type": "application/json" };
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetchImpl(
    `${withTrailingSlash(options.apiBaseUrl ?? "http://localhost:4000")}${path.replace(/^\//, "")}`,
    requestInit
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`AgentGate demo API returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
