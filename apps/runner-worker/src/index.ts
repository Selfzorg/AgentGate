import type { PrismaClient } from "@prisma/client";
import { processQueuedRunById, processQueuedRunsOnce, startRunnerLoop, type RunnerLoopHandle } from "./runner-loop";

export { executeSkillRun } from "./orchestrator/execute-skill-run";
export { processQueuedRunById, processQueuedRunsOnce, startRunnerLoop, type RunnerLoopHandle };

if (process.env.AGENTGATE_STANDALONE_RUNNER === "true") {
  console.log("AgentGate runner-worker placeholder is ready for Phase 3.");
}

export type RunnerBootstrapOptions = {
  prisma: PrismaClient;
  intervalMs?: number;
};
