import { Prisma, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";

export async function claimExecutionLease(
  prisma: PrismaClient,
  input: {
    runId: string;
    runnerId: string;
    leaseSeconds?: number | undefined;
  }
) {
  const attempt = await prisma.skillRunAttempt.findFirst({
    where: {
      skillRunId: input.runId,
      status: { in: ["queued", "executing"] }
    },
    orderBy: { createdAt: "desc" },
    include: {
      skillRun: true
    }
  });

  if (!attempt) return { status: 404 as const, body: { error: "No queued execution attempt found" } };

  const now = new Date();
  if (attempt.status === "executing" && attempt.leaseExpiresAt && attempt.leaseExpiresAt > now && attempt.claimedByRunnerId !== input.runnerId) {
    return { status: 409 as const, body: { error: "Execution attempt is leased by another runner" } };
  }

  const leaseExpiresAt = new Date(now.getTime() + Math.max(input.leaseSeconds ?? 60, 5) * 1000);
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.skillRunAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "executing",
        claimedByRunnerId: input.runnerId,
        leaseExpiresAt,
        heartbeatAt: now,
        startedAt: attempt.startedAt ?? now
      }
    });
    await tx.skillRun.update({
      where: { id: attempt.skillRunId },
      data: { status: "executing" }
    });
    await emitAuditEvent(tx, {
      tenantId: attempt.tenantId,
      workspaceId: attempt.workspaceId,
      skillRunId: attempt.skillRunId,
      traceId: attempt.skillRun.traceId,
      eventType: "execution.lease.claimed",
      actorType: "system",
      actorId: input.runnerId,
      metadata: {
        attempt_id: attempt.id,
        lease_expires_at: leaseExpiresAt.toISOString()
      }
    });
    return claimed;
  });

  return {
    status: 200 as const,
    body: {
      execution_lease: serializeExecutionLease(updated)
    }
  };
}

export async function heartbeatExecutionLease(
  prisma: PrismaClient,
  input: {
    runId: string;
    runnerId: string;
    leaseSeconds?: number | undefined;
  }
) {
  const attempt = await findHeldAttempt(prisma, input.runId, input.runnerId);
  if (!attempt) return { status: 404 as const, body: { error: "Execution lease not found for runner" } };
  if (attempt.leaseExpiresAt && attempt.leaseExpiresAt < new Date()) {
    return { status: 409 as const, body: { error: "Execution lease expired" } };
  }

  const updated = await prisma.skillRunAttempt.update({
    where: { id: attempt.id },
    data: {
      leaseExpiresAt: new Date(Date.now() + Math.max(input.leaseSeconds ?? 60, 5) * 1000),
      heartbeatAt: new Date()
    }
  });

  return {
    status: 200 as const,
    body: {
      execution_lease: serializeExecutionLease(updated)
    }
  };
}

export async function completeExecutionLease(
  prisma: PrismaClient,
  input: {
    runId: string;
    runnerId: string;
    status: "completed" | "failed";
    result?: Record<string, unknown> | undefined;
    error?: Record<string, unknown> | undefined;
  }
) {
  const attempt = await findHeldAttempt(prisma, input.runId, input.runnerId);
  if (!attempt) return { status: 404 as const, body: { error: "Execution lease not found for runner" } };
  if (attempt.leaseExpiresAt && attempt.leaseExpiresAt < new Date()) {
    return { status: 409 as const, body: { error: "Execution lease expired" } };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const completed = await tx.skillRunAttempt.update({
      where: { id: attempt.id },
      data: {
        status: input.status,
        result: input.status === "completed" ? mergeAttemptJson(attempt.result, input.result ?? {}) : jsonInput(attempt.result),
        error: input.status === "failed" ? ((input.error ?? {}) as Prisma.InputJsonValue) : jsonInput(attempt.error),
        completedAt: new Date(),
        leaseExpiresAt: null,
        heartbeatAt: new Date()
      }
    });
    await tx.skillRun.update({
      where: { id: attempt.skillRunId },
      data: { status: input.status }
    });
    await emitAuditEvent(tx, {
      tenantId: attempt.tenantId,
      workspaceId: attempt.workspaceId,
      skillRunId: attempt.skillRunId,
      traceId: attempt.skillRun.traceId,
      eventType: `execution.lease.${input.status}`,
      actorType: "system",
      actorId: input.runnerId,
      metadata: {
        attempt_id: attempt.id,
        status: input.status
      }
    });
    return completed;
  });

  return {
    status: 200 as const,
    body: {
      execution_lease: serializeExecutionLease(updated)
    }
  };
}

async function findHeldAttempt(prisma: PrismaClient, runId: string, runnerId: string) {
  return prisma.skillRunAttempt.findFirst({
    where: {
      skillRunId: runId,
      claimedByRunnerId: runnerId,
      status: "executing"
    },
    orderBy: { createdAt: "desc" },
    include: {
      skillRun: true
    }
  });
}

function serializeExecutionLease(attempt: {
  id: string;
  skillRunId: string;
  status: string;
  claimedByRunnerId: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}) {
  return {
    attempt_id: attempt.id,
    skill_run_id: attempt.skillRunId,
    status: attempt.status,
    runner_id: attempt.claimedByRunnerId,
    lease_expires_at: attempt.leaseExpiresAt?.toISOString() ?? null,
    heartbeat_at: attempt.heartbeatAt?.toISOString() ?? null,
    started_at: attempt.startedAt?.toISOString() ?? null,
    completed_at: attempt.completedAt?.toISOString() ?? null
  };
}

function mergeAttemptJson(existing: unknown, next: Record<string, unknown>) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  return {
    ...base,
    ...next
  } as Prisma.InputJsonValue;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  return value as Prisma.InputJsonValue;
}
