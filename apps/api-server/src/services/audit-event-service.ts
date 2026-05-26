import { Prisma, type ActorType, type PrismaClient } from "@prisma/client";
import { createId } from "./id";

export type AuditEventInput = {
  tenantId: string;
  workspaceId: string;
  skillRunId?: string | null;
  traceId: string;
  eventType: string;
  actorType: ActorType;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function emitAuditEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: AuditEventInput
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
      skillRunId: input.skillRunId ?? null,
      traceId: input.traceId,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      sequence: (latest?.sequence ?? 0) + 1,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
    }
  });
}
