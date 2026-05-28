import { randomUUID } from "node:crypto";
import { Prisma, type ActorType, type PrismaClient } from "@prisma/client";

export type RunnerAuditEventInput = {
  tenantId: string;
  workspaceId: string;
  skillRunId: string;
  traceId: string;
  eventType: string;
  actorType?: ActorType;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function emitRunnerAuditEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: RunnerAuditEventInput
) {
  const latest = await prisma.auditEvent.findFirst({
    where: { traceId: input.traceId },
    orderBy: { sequence: "desc" }
  });

  return prisma.auditEvent.create({
    data: {
      id: createId("aud"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      skillRunId: input.skillRunId,
      traceId: input.traceId,
      eventType: input.eventType,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? "runner",
      sequence: (latest?.sequence ?? 0) + 1,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
    }
  });
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
