import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

type EvidenceStatus = "passed" | "failed" | "missing";
type AgentDriver = "claude" | "codex" | "demo";
type WorkerStatus = "online" | "idle" | "busy" | "offline" | "error";

type EvidenceTask = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  skill_run_id: string;
  trace_id: string;
  check_key: string;
  label: string;
  runtime: string;
  status: string;
  attempt: number;
  input: Record<string, unknown>;
};

export type AgentEvidenceResult = {
  status: EvidenceStatus;
  reason: string;
  evidence: Record<string, unknown>;
};

export type ClaudeEvidenceWorkerConfig = {
  apiBaseUrl: string;
  tenantId: string;
  workspaceId: string;
  skillRunId: string | undefined;
  limit: number;
  maxTasksPerTick: number;
  concurrency: number;
  intervalMs: number;
  leaseSeconds: number;
  heartbeatMs: number;
  agentTimeoutMs: number;
  apiTimeoutMs: number;
  agentId: string;
  runtime: string;
  driver: AgentDriver;
  agentCommand: string | undefined;
  model: string | undefined;
  workspaceDir: string;
  allowedTools: string;
  disallowedTools: string;
  fallbackToLocalDeterministic: boolean;
  logPath: string;
  debug: boolean;
  once: boolean;
};

type WorkerDeps = {
  fetchImpl?: typeof fetch | undefined;
  runAgentEvidence?: ((task: EvidenceTask, config: ClaudeEvidenceWorkerConfig) => Promise<AgentEvidenceResult>) | undefined;
  writeLog?: ((entry: Record<string, unknown>) => Promise<void>) | undefined;
};

type WorkerTickResult = {
  scanned: number;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
};

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { enum: ["passed", "failed", "missing"] },
    reason: { type: "string", minLength: 1 },
    evidence: {
      type: "object",
      additionalProperties: true
    }
  },
  required: ["status", "reason", "evidence"]
};

const DEFAULT_ALLOWED_TOOLS =
  "Read,Glob,Grep,Bash(pwd),Bash(ls *),Bash(rg *),Bash(git status*),Bash(git log*),Bash(git show*)";
const DEFAULT_DISALLOWED_TOOLS =
  "Edit,Write,MultiEdit,NotebookEdit,Bash(*deploy*),Bash(*merge*),Bash(*push*),Bash(*rm *),Bash(*drop*),Bash(*migrate*),Bash(pnpm test*),Bash(npm test*),Bash(vitest*),Bash(pnpm verify*)";

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ClaudeEvidenceWorkerConfig {
  return {
    apiBaseUrl: env.AGENTGATE_API_BASE_URL ?? "http://localhost:4000",
    tenantId: env.AGENTGATE_TENANT_ID ?? "tenant_demo",
    workspaceId: env.AGENTGATE_WORKSPACE_ID ?? "workspace_demo",
    skillRunId: env.AGENTGATE_EVIDENCE_WORKER_SKILL_RUN_ID,
    limit: numberFrom(env.AGENTGATE_EVIDENCE_WORKER_LIMIT, 10),
    maxTasksPerTick: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK, 1),
    concurrency: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_CONCURRENCY, 1),
    intervalMs: numberFrom(env.AGENTGATE_EVIDENCE_WORKER_INTERVAL_MS, 2000),
    leaseSeconds: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_LEASE_SECONDS, 180),
    heartbeatMs: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_HEARTBEAT_MS, 30000),
    agentTimeoutMs: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_TIMEOUT_MS, 300000),
    apiTimeoutMs: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_API_TIMEOUT_MS, 5000),
    agentId: env.AGENTGATE_EVIDENCE_WORKER_AGENT_ID ?? `claude_evidence_worker_${process.pid}`,
    runtime: env.AGENTGATE_EVIDENCE_AGENT_RUNTIME ?? "claude_code_mcp",
    driver: driverFrom(env.AGENTGATE_EVIDENCE_AGENT_DRIVER ?? "claude"),
    agentCommand: env.AGENTGATE_EVIDENCE_AGENT_COMMAND,
    model: env.AGENTGATE_EVIDENCE_AGENT_MODEL,
    workspaceDir: resolve(env.AGENTGATE_PROJECT_ROOT ?? cwd),
    allowedTools: env.AGENTGATE_EVIDENCE_AGENT_ALLOWED_TOOLS ?? DEFAULT_ALLOWED_TOOLS,
    disallowedTools: env.AGENTGATE_EVIDENCE_AGENT_DISALLOWED_TOOLS ?? DEFAULT_DISALLOWED_TOOLS,
    fallbackToLocalDeterministic: !isFalse(env.AGENTGATE_EVIDENCE_AGENT_FALLBACK_DETERMINISTIC ?? "true"),
    logPath: env.AGENTGATE_EVIDENCE_AGENT_LOG_PATH ?? join(cwd, ".agentgate", "logs", "claude-evidence-worker.jsonl"),
    debug: truthy(env.AGENTGATE_EVIDENCE_WORKER_DEBUG),
    once: process.argv.includes("--once")
  };
}

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

export async function runAgentEvidence(task: EvidenceTask, config: ClaudeEvidenceWorkerConfig): Promise<AgentEvidenceResult> {
  if (config.driver === "demo") return runDemoEvidence(task);

  const prompt = buildEvidencePrompt(task);
  const command = commandSpecFor(config);
  const output = await runSubprocess(command.command, command.args, prompt, config);
  return parseAgentOutput(output);
}

export function buildEvidencePrompt(task: EvidenceTask): string {
  return [
    "You are an AgentGate read-only evidence worker.",
    "",
    "Verify the policy gate check described below. You may inspect local repository state, logs, and read-only metadata only.",
    "Prefer fast, bounded checks. For test evidence, inspect existing logs, package scripts, or recent local metadata; do not run the test suite from this worker.",
    "Do not deploy, merge, push, write files, mutate databases, call production systems, or execute the target action.",
    "If evidence is not clearly present, return status \"missing\". If evidence contradicts the requirement, return status \"failed\".",
    "",
    "Return JSON only with this exact shape:",
    "{\"status\":\"passed|failed|missing\",\"reason\":\"short reason\",\"evidence\":{}}",
    "",
    "Evidence task:",
    JSON.stringify(redactValue(task), null, 2)
  ].join("\n");
}

export function parseAgentOutput(output: string): AgentEvidenceResult {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("Evidence agent returned empty output.");

  const parsed = parseJsonLoose(trimmed);
  const candidates = [
    parsed,
    recordFrom(parsed).result,
    recordFrom(parsed).content,
    recordFrom(parsed).message,
    recordFrom(parsed).text
  ];

  for (const candidate of candidates) {
    const resolved = typeof candidate === "string" ? parseJsonLoose(candidate) : candidate;
    const normalized = tryNormalizeAgentResult(resolved);
    if (normalized) return normalized;
  }

  throw new Error("Evidence agent output did not match the required JSON schema.");
}

function tryNormalizeAgentResult(value: unknown): AgentEvidenceResult | null {
  const record = recordFrom(value);
  const status = record.status;
  const reason = record.reason;
  if (status !== "passed" && status !== "failed" && status !== "missing") return null;
  if (typeof reason !== "string" || reason.trim().length === 0) return null;

  return {
    status,
    reason,
    evidence: recordFrom(record.evidence)
  };
}

function runDemoEvidence(task: EvidenceTask): AgentEvidenceResult {
  const passingChecks = new Set(["ci_passed", "tests_passed", "rollback_plan_exists", "staging_deploy_successful"]);
  const passed = passingChecks.has(task.check_key);
  return {
    status: passed ? "passed" : "missing",
    reason: passed
      ? `${task.label} verified by demo Claude evidence worker.`
      : `${task.label} evidence is missing in demo Claude evidence worker.`,
    evidence: {
      source: "claude_evidence_worker_demo",
      task_id: task.id,
      check_key: task.check_key,
      runtime: task.runtime,
      inspected: ["evidence_task.input"]
    }
  };
}

function localDeterministicFallbackResult(
  task: EvidenceTask,
  config: ClaudeEvidenceWorkerConfig,
  agentFailureReason: string
): AgentEvidenceResult | null {
  if (!config.fallbackToLocalDeterministic || config.driver === "demo") return null;
  if (!taskAllowsLocalDeterministic(task)) return null;

  const fallback = runDemoEvidence(task);
  const failureSummary = redactString(agentFailureReason).slice(0, 300);
  return {
    ...fallback,
    reason: `${fallback.reason} Local deterministic fallback used after agent runtime error.`,
    evidence: {
      ...fallback.evidence,
      source: "local_deterministic_fallback",
      fallback_from_runtime: config.runtime,
      fallback_from_driver: config.driver,
      fallback_reason: failureSummary
    }
  };
}

function taskAllowsLocalDeterministic(task: EvidenceTask): boolean {
  const evidenceSkill = recordFrom(recordFrom(task.input).evidence_skill);
  const allowed = evidenceSkill.allowed_runtimes;
  if (!Array.isArray(allowed)) return true;
  return allowed.includes("local_deterministic") || allowed.includes("deterministic") || allowed.includes("agent");
}

export function commandSpecFor(config: ClaudeEvidenceWorkerConfig) {
  if (config.agentCommand) {
    const [command, ...args] = splitCommand(config.agentCommand);
    if (!command) throw new Error("AGENTGATE_EVIDENCE_AGENT_COMMAND is empty.");
    return { command, args };
  }

  if (config.driver === "codex") {
    const args = [
      "exec",
      "--cd",
      config.workspaceDir,
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "--ephemeral",
      "--color",
      "never",
      "-"
    ];
    if (config.model) args.splice(1, 0, "--model", config.model);
    return { command: "codex", args };
  }

  const args = [
    "--bare",
    "--print",
    "--input-format",
    "text",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--add-dir",
    config.workspaceDir,
    "--allowedTools",
    config.allowedTools,
    "--disallowedTools",
    config.disallowedTools,
    "--json-schema",
    JSON.stringify(RESULT_SCHEMA)
  ];
  if (config.model) args.splice(0, 0, "--model", config.model);
  return { command: "claude", args };
}

function runSubprocess(command: string, args: string[], prompt: string, config: ClaudeEvidenceWorkerConfig): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: config.workspaceDir,
      env: {
        ...process.env,
        AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART: "false",
        AGENTGATE_EVIDENCE_WORKER_CHILD: "true"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${config.agentTimeoutMs}ms.`));
    }, config.agentTimeoutMs);
    timeout.unref?.();

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${redactString(stderr || stdout)}`));
    });
    child.stdin.end(prompt);
  });
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const timeout = delay(timeoutMs).then(() => {
    throw new Error(message);
  });
  return Promise.race([promise, timeout]);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  requestedConcurrency: number | undefined,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const concurrency = Math.max(1, Math.min(Math.floor(requestedConcurrency ?? 1), Math.max(items.length, 1)));
  const results = new Array<R>(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await worker(items[currentIndex]!);
      }
    })
  );

  return results;
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

function normalizeAgentResult(value: AgentEvidenceResult): AgentEvidenceResult {
  const normalized = tryNormalizeAgentResult(value);
  if (!normalized) throw new Error("Evidence agent result did not match the required JSON schema.");
  return normalized;
}

function parseJsonLoose(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Evidence agent output did not contain JSON.");
    return JSON.parse(match[0]);
  }
}

function splitCommand(value: string): string[] {
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function driverFrom(value: string): AgentDriver {
  const normalized = value.toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "demo" || normalized === "deterministic") return "demo";
  return "claude";
}

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function isFalse(value: unknown): boolean {
  return ["0", "false", "no", "off"].includes(String(value ?? "").toLowerCase());
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function redactString(value: string): string {
  return String(redactValue(value));
}

function redactValue(value: unknown): unknown {
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

const secretKeyPattern = /(token|secret|password|api.?key|authorization|token.?hash|hash)/i;

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
