import type { PrismaClient } from "@prisma/client";

export type RunnerLoopHandle = {
  stop(): void;
};

export type RunnerLoopOptions = {
  prisma: PrismaClient;
  intervalMs?: number;
};

export function startRunnerLoop(options: RunnerLoopOptions): RunnerLoopHandle {
  const timer = setInterval(() => {
    if (process.env.AGENTGATE_RUNNER_DEBUG === "true") {
      console.log("AgentGate Phase 0 runner heartbeat");
    }
  }, options.intervalMs ?? 500);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}
