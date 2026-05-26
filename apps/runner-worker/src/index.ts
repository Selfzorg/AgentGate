import type { PrismaClient } from "@prisma/client";
import { startRunnerLoop, type RunnerLoopHandle } from "./runner-loop";

export { startRunnerLoop, type RunnerLoopHandle };

if (process.env.AGENTGATE_STANDALONE_RUNNER === "true") {
  console.log("AgentGate runner-worker placeholder is ready for Phase 3.");
}

export type RunnerBootstrapOptions = {
  prisma: PrismaClient;
  intervalMs?: number;
};
