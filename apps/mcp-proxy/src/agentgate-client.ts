import { redactValue } from "./redact.js";

export type Decision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";

export type AgentGateDecision = {
  decision: Decision;
  skill_id: string;
  skill_version: string;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_score: number;
  risk_reasons: string[];
  reason: string;
  trace_id: string;
  run_id: string;
  mode: "observe" | "warn" | "enforce";
  dry_run_required?: boolean;
  missing_checks?: string[];
};

export type AgentGateMcpConfig = {
  apiBaseUrl: string;
  tenantId: string;
  workspaceId: string;
  timeoutMs: number;
};

export type AgentGateAgent = {
  agent_id: string;
  agent_type: string;
  role: string;
};

export type InvokeMcpInput = {
  server?: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  context?: Record<string, unknown>;
  agent: AgentGateAgent;
};

export type AgentGateExecutionToken = {
  execution_token_id: string;
  skill_run_id: string;
  approval_id: string | null;
  scopes: string[];
  ttl_seconds: number;
  token_type: "agentgate_bearer";
  token_value_available: boolean;
  token_value?: string;
  status: string;
  expires_at: string;
};

export type AgentGateExecutionQueueResult = {
  run_id: string;
  status: string;
  attempt_id: string;
  logs_url: string;
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AgentGateMcpConfig {
  return {
    apiBaseUrl: env.AGENTGATE_API_BASE_URL ?? "http://localhost:4000",
    tenantId: env.AGENTGATE_TENANT_ID ?? "tenant_demo",
    workspaceId: env.AGENTGATE_WORKSPACE_ID ?? "workspace_demo",
    timeoutMs: Number(env.AGENTGATE_MCP_TIMEOUT_MS ?? 5000)
  };
}

export async function invokeMcpTool(input: InvokeMcpInput, config = configFromEnv()): Promise<AgentGateDecision> {
  return requestJson<AgentGateDecision>(config, "/api/v1/mcp/invoke", {
    method: "POST",
    body: {
      tenant_id: config.tenantId,
      workspace_id: config.workspaceId,
      agent: input.agent,
      server: input.server ?? "agentgate",
      tool_name: input.toolName,
      arguments: redactValue(input.arguments ?? {}),
      context: redactValue(input.context ?? {})
    }
  });
}

export async function replayDemoAction(actionId: string, config = configFromEnv()): Promise<{ action_id: string; decision: AgentGateDecision }> {
  return requestJson(config, `/api/v1/demo/actions/${encodeURIComponent(actionId)}/replay`, {
    method: "POST"
  });
}

export async function getRun(runId: string, config = configFromEnv()): Promise<unknown> {
  return requestJson(config, `/api/v1/skill-runs/${encodeURIComponent(runId)}`);
}

export async function getAuditTrace(traceId: string, config = configFromEnv()): Promise<unknown> {
  const [events, integrity] = await Promise.all([
    requestJson(config, `/api/v1/audit-events?trace_id=${encodeURIComponent(traceId)}`),
    requestJson(config, `/api/v1/audit-integrity?trace_id=${encodeURIComponent(traceId)}`)
  ]);

  return {
    audit_events: (events as { audit_events?: unknown[] }).audit_events ?? [],
    audit_integrity: (integrity as { audit_integrity?: unknown }).audit_integrity ?? null
  };
}

export async function issueExecutionToken(
  runId: string,
  input: { approvalId?: string | undefined } = {},
  config = configFromEnv()
): Promise<{ execution_token: AgentGateExecutionToken }> {
  return requestJson(config, "/api/v1/execution-tokens", {
    method: "POST",
    body: {
      skill_run_id: runId,
      ...(input.approvalId ? { approval_id: input.approvalId } : {})
    }
  });
}

export async function executeRun(
  runId: string,
  input: { executionTokenId?: string | undefined; executionToken?: string | undefined; idempotencyKey: string },
  config = configFromEnv()
): Promise<AgentGateExecutionQueueResult> {
  return requestJson(config, `/api/v1/skill-runs/${encodeURIComponent(runId)}/execute`, {
    method: "POST",
    body: {
      idempotency_key: input.idempotencyKey,
      ...(input.executionTokenId ? { execution_token_id: input.executionTokenId } : {}),
      ...(input.executionToken ? { execution_token: input.executionToken } : {})
    }
  });
}

export async function listEvidenceTasks(
  input: { skillRunId?: string | undefined; limit?: number | undefined; newestFirst?: boolean | undefined } = {},
  config = configFromEnv()
): Promise<unknown> {
  const params = new URLSearchParams({
    tenant_id: config.tenantId,
    workspace_id: config.workspaceId
  });
  if (input.skillRunId) params.set("skill_run_id", input.skillRunId);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.newestFirst) params.set("newest_first", "true");

  return requestJson(config, `/api/v1/evidence-tasks?${params.toString()}`);
}

export async function getEvidenceTask(taskId: string, config = configFromEnv()): Promise<unknown> {
  return requestJson(config, `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}`);
}

export async function claimEvidenceTask(
  taskId: string,
  input: { agentId: string; runtime: string; leaseSeconds?: number | undefined },
  config = configFromEnv()
): Promise<unknown> {
  return requestJson(config, `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/claim`, {
    method: "POST",
    body: {
      agent_id: input.agentId,
      runtime: input.runtime,
      lease_seconds: input.leaseSeconds
    }
  });
}

export async function submitEvidenceTaskResult(
  taskId: string,
  input: {
    agentId: string;
    status: "passed" | "failed" | "missing";
    reason: string;
    evidence?: Record<string, unknown> | undefined;
  },
  config = configFromEnv()
): Promise<unknown> {
  return requestJson(config, `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
    body: {
      agent_id: input.agentId,
      status: input.status,
      reason: input.reason,
      evidence: input.evidence ?? {}
    }
  });
}

export async function failEvidenceTask(
  taskId: string,
  input: { agentId: string; reason: string; error?: Record<string, unknown> | undefined },
  config = configFromEnv()
): Promise<unknown> {
  return requestJson(config, `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/fail`, {
    method: "POST",
    body: {
      agent_id: input.agentId,
      reason: input.reason,
      error: input.error ?? {}
    }
  });
}

async function requestJson<T>(config: AgentGateMcpConfig, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const url = new URL(path, withTrailingSlash(config.apiBaseUrl));

  try {
    const requestInit: RequestInit = {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" })
      },
      signal: controller.signal
    };
    if (init.body !== undefined) requestInit.body = JSON.stringify(redactValue(init.body));

    const response = await fetch(url, requestInit);

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`AgentGate API returned HTTP ${response.status}: ${JSON.stringify(redactValue(body))}`);
    }

    return redactValue(body) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
