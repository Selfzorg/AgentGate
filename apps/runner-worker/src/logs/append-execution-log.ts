import { randomUUID } from "node:crypto";
import { Prisma, type LogLevel, type PrismaClient } from "@prisma/client";

export type ExecutionLogInput = {
  tenantId: string;
  workspaceId: string;
  skillRunId: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
};

export async function appendExecutionLog(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: ExecutionLogInput
) {
  const latest = await prisma.executionLog.findFirst({
    where: { skillRunId: input.skillRunId },
    orderBy: { sequence: "desc" }
  });

  return prisma.executionLog.create({
    data: {
      id: createId("elog"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      skillRunId: input.skillRunId,
      sequence: (latest?.sequence ?? 0) + 1,
      level: input.level,
      message: input.message,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
    }
  });
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
