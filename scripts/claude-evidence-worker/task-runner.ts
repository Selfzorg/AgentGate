import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { localDeterministicFallbackResult, runAgentEvidence } from "./agent-runtime";
import { normalizeAgentResult } from "./prompt";
import { redactValue } from "./redaction";
import type { ClaudeEvidenceWorkerConfig, EvidenceTask, WorkerDeps, WorkerStatus } from "./types";
import { withTimeout } from "./utils";
import {
  AgentGateHttpError,
  claimEvidenceTask,
  completeEvidenceTask,
  failEvidenceTask,
  getEvidenceTask,
  heartbeatEvidenceTask,
  markWorkerStopped,
  recordWorkerHeartbeat
} from "./api-client";

export async function processEvidenceTask(task: EvidenceTask, config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
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

export async function safeRecordWorkerHeartbeat(
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

export async function safeMarkWorkerStopped(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps) {
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

export async function log(config: ClaudeEvidenceWorkerConfig, deps: WorkerDeps, entry: Record<string, unknown>) {
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
