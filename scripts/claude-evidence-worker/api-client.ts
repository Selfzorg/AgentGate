import { redactValue } from "./redaction";
import type { AgentEvidenceResult, ClaudeEvidenceWorkerConfig, EvidenceTask, WorkerDeps, WorkerStatus } from "./types";
import { withTrailingSlash } from "./utils";

export async function listEvidenceTasks(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps): Promise<EvidenceTask[]> {
  const params = new URLSearchParams({
    tenant_id: config.tenantId,
    workspace_id: config.workspaceId,
    newest_first: "true",
    limit: String(config.limit)
  });
  if (config.skillRunId) params.set("skill_run_id", config.skillRunId);
  const body = await requestJson<{ evidence_tasks?: EvidenceTask[] }>(config, `/api/v1/evidence-tasks?${params.toString()}`, {}, deps);
  return Array.isArray(body.evidence_tasks) ? body.evidence_tasks : [];
}

export async function getEvidenceTask(taskId: string, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps): Promise<EvidenceTask> {
  const body = await requestJson<{ evidence_task: EvidenceTask }>(
    config,
    `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}`,
    {},
    deps
  );
  return body.evidence_task;
}

export async function claimEvidenceTask(taskId: string, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps): Promise<EvidenceTask> {
  const body = await requestJson<{ evidence_task: EvidenceTask }>(
    config,
    `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/claim`,
    {
      method: "POST",
      body: {
        agent_id: config.agentId,
        runtime: config.runtime,
        lease_seconds: config.leaseSeconds
      }
    },
    deps
  );
  return body.evidence_task;
}

export async function heartbeatEvidenceTask(taskId: string, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
  await requestJson(
    config,
    `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/heartbeat`,
    {
      method: "POST",
      body: {
        agent_id: config.agentId,
        lease_seconds: config.leaseSeconds
      }
    },
    deps
  );
}

export async function recordWorkerHeartbeat(
  status: WorkerStatus,
  config: ClaudeEvidenceWorkerConfig,
  deps: WorkerDeps,
  options: {
    task?: EvidenceTask | undefined;
    processedDelta?: number | undefined;
    failedDelta?: number | undefined;
  } = {}
) {
  await requestJson(
    config,
    "/api/v1/evidence-workers/heartbeat",
    {
      method: "POST",
      body: {
        tenant_id: config.tenantId,
        workspace_id: config.workspaceId,
        agent_id: config.agentId,
        runtime: config.runtime,
        driver: config.driver,
        status,
        current_task_id: options.task?.id ?? null,
        current_check_key: options.task?.check_key ?? null,
        processed_delta: options.processedDelta,
        failed_delta: options.failedDelta,
        capabilities: {
          runtime_ids: [config.runtime],
          allowed_tools: toolListFrom(config.allowedTools),
          side_effect_levels: ["read_only"],
          max_parallel_tasks: config.concurrency,
          supports_json_schema: config.driver === "claude"
        },
        metadata: {
          pid: process.pid,
          once: config.once,
          max_tasks_per_tick: config.maxTasksPerTick,
          concurrency: config.concurrency,
          interval_ms: config.intervalMs
        }
      }
    },
    deps
  );
}

function toolListFrom(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function markWorkerStopped(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
  await requestJson(
    config,
    `/api/v1/evidence-workers/${encodeURIComponent(config.agentId)}/stop`,
    {
      method: "POST",
      body: {
        tenant_id: config.tenantId,
        workspace_id: config.workspaceId
      }
    },
    deps
  );
}

export async function completeEvidenceTask(
  taskId: string,
  result: AgentEvidenceResult,
  config: ClaudeEvidenceWorkerConfig,
  deps: WorkerDeps
) {
  await requestJson(
    config,
    `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/complete`,
    {
      method: "POST",
      body: {
        agent_id: config.agentId,
        status: result.status,
        reason: result.reason,
        evidence: result.evidence
      }
    },
    deps
  );
}

export async function failEvidenceTask(
  taskId: string,
  failure: { reason: string; error: Record<string, unknown> },
  config: ClaudeEvidenceWorkerConfig,
  deps: WorkerDeps
) {
  await requestJson(
    config,
    `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/fail`,
    {
      method: "POST",
      body: {
        agent_id: config.agentId,
        reason: failure.reason,
        error: failure.error
      }
    },
    deps
  );
}

export async function requestJson<T>(
  config: ClaudeEvidenceWorkerConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
  deps: WorkerDeps = {}
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is not available in this Node.js runtime.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs);
  const url = new URL(path, withTrailingSlash(config.apiBaseUrl));

  try {
    const response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AgentGateHttpError(`AgentGate API returned HTTP ${response.status}: ${JSON.stringify(redactValue(body))}`, response.status, body);
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export class AgentGateHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "AgentGateHttpError";
  }
}
