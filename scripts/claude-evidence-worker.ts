import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { configFromEnv } from "./claude-evidence-worker/config";
import { redactString } from "./claude-evidence-worker/redaction";
import type { ClaudeEvidenceWorkerConfig, WorkerDeps, WorkerTickResult } from "./claude-evidence-worker/types";
import { mapWithConcurrency } from "./claude-evidence-worker/utils";
import { log, processEvidenceTask, safeMarkWorkerStopped, safeRecordWorkerHeartbeat } from "./claude-evidence-worker/task-runner";
import { listEvidenceTasks } from "./claude-evidence-worker/api-client";

export { commandSpecFor } from "./claude-evidence-worker/command";
export { configFromEnv, resolveCodexCommand } from "./claude-evidence-worker/config";
export { agentSubprocessOptions, prepareEvidenceTaskForAgent } from "./claude-evidence-worker/agent-runtime";
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
