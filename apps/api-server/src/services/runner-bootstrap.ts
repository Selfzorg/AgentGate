import type { PrismaClient } from "@prisma/client";
import { startRunnerLoop } from "@agentgate/runner-worker";

export function bootstrapRunner(prisma: PrismaClient) {
  return startRunnerLoop({ prisma });
}
