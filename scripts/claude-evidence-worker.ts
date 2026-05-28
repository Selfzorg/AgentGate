import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { localDeterministicFallbackResult, runAgentEvidence } from "./claude-evidence-worker/agent-runtime";
import { configFromEnv } from "./claude-evidence-worker/config";
import { normalizeAgentResult } from "./claude-evidence-worker/prompt";
import { redactString, redactValue } from "./claude-evidence-worker/redaction";
import type {
  AgentEvidenceResult,
  ClaudeEvidenceWorkerConfig,
  EvidenceTask,
  WorkerDeps,
  WorkerStatus,
  WorkerTickResult
} from "./claude-evidence-worker/types";
import { mapWithConcurrency, withTimeout, withTrailingSlash } from "./claude-evidence-worker/utils";

export { commandSpecFor } from "./claude-evidence-worker/command";
export { configFromEnv } from "./claude-evidence-worker/config";
export { buildEvidencePrompt, parseAgentOutput } from "./claude-evidence-worker/prompt";
export type { AgentEvidenceResult, ClaudeEvidenceWorkerConfig } from "./claude-evidence-worker/types";

export async function runWorkerLoop(
  config: ClaudeEvidenceWorkerConfig,
  shouldStop: () => boolean,
  deps: WorkerDeps = {}
) {
  await log(config, deps, {
    event: "worker.started",
    driver: config.driver,
    runtime: config.runtime,
    agent_id: config.agentId,
    interval_ms: config.intervalMs
  });
  await safeRecordWorkerHeartbeat("idle", config, deps);

  while (!shouldStop()) {
    try {
      const result = await runWorkerOnce(config, deps);
      if (result.claimed > 0 || result.failed > 0 || config.debug) {
        console.log(JSON.stringify({ service: "agentgate-claude-evidence-worker", ...result }));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await log(config, deps, {
        event: "worker.tick_failed",
        agent_id: config.agentId,
        reason
      });
      await safeRecordWorkerHeartbeat("error", config, deps);
      console.error(`AgentGate evidence worker tick failed: ${redactString(reason)}`);
    }
    if (!shouldStop()) await delay(config.intervalMs);
  }

  await safeMarkWorkerStopped(config, deps);
  await log(config, deps, { event: "worker.stopped", agent_id: config.agentId });
}

export async function runWorkerOnce(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps = {}): Promise<WorkerTickResult> {
  await safeRecordWorkerHeartbeat("idle", config, deps);
  const tasks = await listEvidenceTasks(config, deps);
  const result: WorkerTickResult = {
    scanned: tasks.length,
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0
  };

  const outcomes = await mapWithConcurrency(tasks.slice(0, config.maxTasksPerTick), config.concurrency, (task) =>
    processEvidenceTask(task, config, deps)
  );

  for (const outcome of outcomes) {
    result.claimed += outcome.claimed ? 1 : 0;
    result.completed += outcome.completed ? 1 : 0;
    result.failed += outcome.failed ? 1 : 0;
    result.skipped += outcome.skipped ? 1 : 0;
  }

  return result;
}

async function processEvidenceTask(task: EvidenceTask, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
  let claimedTask: EvidenceTask;
  try {
    claimedTask = await claimEvidenceTask(task.id, config, deps);
  } catch (error) {
    if (error instanceof AgentGateHttpError && (error.status === 400 || error.status === 409)) {
      await log(config, deps, {
        event: "task.skipped",
        task_id: task.id,
        check_key: task.check_key,
        reason: error.message,
        status: error.status
      });
      return { claimed: false, completed: false, failed: false, skipped: true };
    }
    throw error;
  }

  await log(config, deps, {
    event: "task.claimed",
    task_id: claimedTask.id,
    run_id: claimedTask.skill_run_id,
    check_key: claimedTask.check_key,
    runtime: config.runtime,
    agent_id: config.agentId
  });
  await safeRecordWorkerHeartbeat("busy", config, deps, {
    task: claimedTask
  });

  const heartbeat = startHeartbeat(claimedTask, config, deps);
  try {
    const agentRunner = deps.runAgentEvidence ?? runAgentEvidence;
    const agentResult = await withTimeout(
      agentRunner(claimedTask, config),
      config.agentTimeoutMs,
      `Evidence agent timed out after ${config.agentTimeoutMs}ms.`
    );
    const normalized = normalizeAgentResult(agentResult);
    heartbeat.stop();
    await completeEvidenceTask(claimedTask.id, normalized, config, deps);
    await log(config, deps, {
      event: "task.completed",
      task_id: claimedTask.id,
      check_key: claimedTask.check_key,
      evidence_status: normalized.status,
      reason: normalized.reason
    });
    await safeRecordWorkerHeartbeat("idle", config, deps, {
      processedDelta: 1
    });
    return { claimed: true, completed: true, failed: false, skipped: false };
  } catch (error) {
    heartbeat.stop();
    const reason = error instanceof Error ? error.message : String(error);
    const terminalOutcome = await resolveTerminalTaskOutcome(claimedTask.id, reason, config, deps);
    if (terminalOutcome) return terminalOutcome;

    const fallback = localDeterministicFallbackResult(claimedTask, config, reason);
    if (fallback) {
      await completeEvidenceTask(claimedTask.id, fallback, config, deps);
      await log(config, deps, {
        event: "task.fallback_completed",
        task_id: claimedTask.id,
        check_key: claimedTask.check_key,
        fallback_runtime: "local_deterministic",
        original_runtime: config.runtime,
        original_reason: reason,
        evidence_status: fallback.status,
        reason: fallback.reason
      });
      await safeRecordWorkerHeartbeat("idle", config, deps, {
        processedDelta: 1
      });
      return { claimed: true, completed: true, failed: false, skipped: false };
    }

    try {
      await failEvidenceTask(
        claimedTask.id,
        {
          reason,
          error: {
            driver: config.driver,
            runtime: config.runtime
          }
        },
        config,
        deps
      );
    } catch (failError) {
      if (failError instanceof AgentGateHttpError && failError.status === 409) {
        const outcome = await resolveTerminalTaskOutcome(claimedTask.id, reason, config, deps);
        if (outcome) return outcome;
      }
      throw failError;
    }
    await log(config, deps, {
      event: "task.failed",
      task_id: claimedTask.id,
      check_key: claimedTask.check_key,
      reason
    });
    await safeRecordWorkerHeartbeat("idle", config, deps, {
      failedDelta: 1
    });
    return { claimed: true, completed: false, failed: true, skipped: false };
  } finally {
    heartbeat.stop();
  }
}

async function listEvidenceTasks(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps): Promise<EvidenceTask[]> {
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

async function getEvidenceTask(taskId: string, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps): Promise<EvidenceTask> {
  const body = await requestJson<{ evidence_task: EvidenceTask }>(
    config,
    `/api/v1/evidence-tasks/${encodeURIComponent(taskId)}`,
    {},
    deps
  );
  return body.evidence_task;
}

async function claimEvidenceTask(taskId: string, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps): Promise<EvidenceTask> {
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

async function heartbeatEvidenceTask(taskId: string, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
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

async function recordWorkerHeartbeat(
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

async function markWorkerStopped(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
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

async function resolveTerminalTaskOutcome(
  taskId: string,
  originalReason: string,
  config: ClaudeEvidenceWorkerConfig,
  deps: WorkerDeps
) {
  let current: EvidenceTask;
  try {
    current = await getEvidenceTask(taskId, config, deps);
  } catch (error) {
    await log(config, deps, {
      event: "task.terminal_check_failed",
      task_id: taskId,
      original_reason: originalReason,
      reason: error instanceof Error ? error.message : String(error)
    });
    return null;
  }

  if (current.status === "succeeded") {
    await log(config, deps, {
      event: "task.already_terminal",
      task_id: taskId,
      check_key: current.check_key,
      status: current.status,
      original_reason: originalReason
    });
    await safeRecordWorkerHeartbeat("idle", config, deps, {
      processedDelta: 1
    });
    return { claimed: true, completed: true, failed: false, skipped: false };
  }

  if (current.status === "failed" || current.status === "timed_out" || current.status === "cancelled") {
    await log(config, deps, {
      event: "task.already_terminal",
      task_id: taskId,
      check_key: current.check_key,
      status: current.status,
      original_reason: originalReason
    });
    await safeRecordWorkerHeartbeat("idle", config, deps, {
      failedDelta: current.status === "cancelled" ? 0 : 1
    });
    return {
      claimed: true,
      completed: false,
      failed: current.status !== "cancelled",
      skipped: current.status === "cancelled"
    };
  }

  return null;
}

async function completeEvidenceTask(
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

async function failEvidenceTask(
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

async function requestJson<T>(
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

class AgentGateHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "AgentGateHttpError";
  }
}

function startHeartbeat(task: EvidenceTask, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
  const timer = setInterval(() => {
    void heartbeatEvidenceTask(task.id, config, deps).catch((error) =>
      log(config, deps, {
        event: "task.heartbeat_failed",
        task_id: task.id,
        reason: error instanceof Error ? error.message : String(error)
      })
    );
    void safeRecordWorkerHeartbeat("busy", config, deps, { task });
  }, Math.max(config.heartbeatMs, 1000));
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
    }
  };
}

async function safeRecordWorkerHeartbeat(
  status: WorkerStatus,
  config: ClaudeEvidenceWorkerConfig,
  deps: WorkerDeps,
  options: {
    task?: EvidenceTask | undefined;
    processedDelta?: number | undefined;
    failedDelta?: number | undefined;
  } = {}
) {
  try {
    await recordWorkerHeartbeat(status, config, deps, options);
  } catch (error) {
    await log(config, deps, {
      event: "worker.heartbeat_failed",
      agent_id: config.agentId,
      status,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

async function safeMarkWorkerStopped(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
  try {
    await markWorkerStopped(config, deps);
  } catch (error) {
    await log(config, deps, {
      event: "worker.stop_failed",
      agent_id: config.agentId,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

async function log(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps, entry: Record<string, unknown>) {
  const payload = {
    timestamp: new Date().toISOString(),
    ...redactValue(entry)
  };
  if (deps.writeLog) {
    await deps.writeLog(payload);
    return;
  }
  await mkdir(dirname(config.logPath), { recursive: true });
  await appendFile(config.logPath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function main() {
  const config = configFromEnv();
  let stopped = false;
  process.once("SIGINT", () => {
    stopped = true;
  });
  process.once("SIGTERM", () => {
    stopped = true;
  });

  if (config.once) {
    const result = await runWorkerOnce(config);
    console.log(JSON.stringify({ service: "agentgate-claude-evidence-worker", ...result }));
    return;
  }

  console.log(`AgentGate Claude evidence worker polling every ${config.intervalMs}ms.`);
  await runWorkerLoop(config, () => stopped);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
