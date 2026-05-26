import type { PrismaClient } from "@prisma/client";
import { claimQueuedRun, findQueuedRunIds } from "./orchestrator/claim-next-run";
import { executeSkillRun } from "./orchestrator/execute-skill-run";

export type RunnerLoopHandle = {
  stop(): void;
};

export type RunnerLoopOptions = {
  prisma: PrismaClient;
  intervalMs?: number;
};

export async function processQueuedRunsOnce(options: RunnerLoopOptions & { limit?: number }) {
  const runIds = await findQueuedRunIds(options.prisma, options.limit ?? 5);
  let claimed = 0;

  for (const runId of runIds) {
    const didClaim = await claimQueuedRun(options.prisma, runId);
    if (!didClaim) continue;

    claimed += 1;
    await executeSkillRun(options.prisma, runId);
  }

  return {
    scanned: runIds.length,
    claimed
  };
}

export function startRunnerLoop(options: RunnerLoopOptions): RunnerLoopHandle {
  let stopped = false;
  let ticking = false;

  async function tick() {
    if (stopped || ticking) return;
    ticking = true;

    try {
      await processQueuedRunsOnce(options);
    } catch (error) {
      if (process.env.AGENTGATE_RUNNER_DEBUG === "true") {
        console.error(error);
      }
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(() => void tick(), options.intervalMs ?? 500);
  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
