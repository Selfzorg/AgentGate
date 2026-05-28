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
  if ("$transaction" in prisma) {
    return prisma.$transaction((tx) => emitAuditEventInTransaction(tx, input));
  }

  return emitAuditEventInTransaction(prisma, input);
}

async function emitAuditEventInTransaction(
  prisma: Prisma.TransactionClient,
  input: AuditEventInput
) {
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.traceId}))`;

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
