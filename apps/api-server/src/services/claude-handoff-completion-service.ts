import { Prisma, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createId } from "./id";
import { recordFrom } from "./object-utils";

export type CompleteClaudeHandoffInput = {
  runId: string;
  status: "completed" | "failed";
  summary?: string | undefined;
  error?: Record<string, unknown> | undefined;
  requestedBy?: string | undefined;
};

export async function completeClaudeHandoff(prisma: PrismaClient, input: CompleteClaudeHandoffInput) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.skillRun.findUnique({
      where: { id: input.runId },
      include: {
        skillRunAttempts: {
          where: {
            claimedByRunnerId: "claude-code"
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (!run) return { status: 404 as const, body: { error: "Skill run not found" } };

    const attempt = run.skillRunAttempts[0];
    if (!attempt) {
      return {
        status: 404 as const,
        body: { error: "No Claude handoff attempt found for this run" }
      };
    }

    if (attempt.status !== "executing") {
      if (attempt.status === input.status && run.status === input.status) {
        return {
          status: 200 as const,
          body: {
            claude_handoff: {
              run_id: run.id,
              status: "already_finalized",
              attempt_id: attempt.id,
              final_status: input.status
            },
            execution_lease: serializeClaudeAttempt(attempt)
          }
        };
      }

      return {
        status: 409 as const,
        body: {
          error: "Claude handoff completion rejected because the latest Claude attempt is not executing",
          attempt_status: attempt.status,
          run_status: run.status
        }
      };
    }

    const now = new Date();
    const summary = input.summary?.trim() || defaultCompletionSummary(input.status);
    const completed = await tx.skillRunAttempt.update({
      where: { id: attempt.id },
      data: {
        status: input.status,
        result:
          input.status === "completed"
            ? mergeAttemptJson(attempt.result, {
                claude_completion: {
                  status: input.status,
                  summary,
                  completed_by: input.requestedBy ?? "claude-code",
                  completed_at: now.toISOString()
                }
              })
            : jsonInput(attempt.result),
        error:
          input.status === "failed"
            ? ({
                ...(recordFrom(input.error).message ? input.error : {}),
                summary,
                failed_by: input.requestedBy ?? "claude-code",
                failed_at: now.toISOString()
              } as Prisma.InputJsonValue)
            : jsonInput(attempt.error),
        completedAt: now,
        leaseExpiresAt: null,
        heartbeatAt: now
      }
    });

    await tx.skillRun.update({
      where: { id: run.id },
      data: { status: input.status }
    });

    await appendExecutionLog(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      level: input.status === "failed" ? "error" : "info",
      message: summary,
      metadata: {
        attempt_id: attempt.id,
        status: input.status,
        completed_by: input.requestedBy ?? "claude-code"
      }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: input.status === "completed" ? "execution.completed" : "execution.failed",
      actorType: "agent",
      actorId: input.requestedBy ?? "claude-code",
      metadata: {
        attempt_id: attempt.id,
        status: input.status,
        summary
      }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "audit.finalized",
      actorType: "system",
      actorId: "agentgate",
      metadata: {
        attempt_id: attempt.id,
        final_status: input.status,
        finalized_after: "claude_handoff"
      }
    });

    return {
      status: 200 as const,
      body: {
        claude_handoff: {
          run_id: run.id,
          status: input.status,
          attempt_id: attempt.id,
          logs_url: `/api/v1/skill-runs/${run.id}/logs`
        },
        execution_lease: serializeClaudeAttempt(completed)
      }
    };
  });
}

async function appendExecutionLog(
  prisma: Prisma.TransactionClient,
  input: {
    tenantId: string;
    workspaceId: string;
    skillRunId: string;
    level?: "debug" | "info" | "warn" | "error" | undefined;
    message: string;
    metadata: Record<string, unknown>;
  }
) {
  const latest = await prisma.executionLog.findFirst({
    where: { skillRunId: input.skillRunId },
    orderBy: { sequence: "desc" }
  });

  await prisma.executionLog.create({
    data: {
      id: createId("elog"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      skillRunId: input.skillRunId,
      sequence: (latest?.sequence ?? 0) + 1,
      level: input.level ?? "info",
      message: input.message,
      metadata: input.metadata as Prisma.InputJsonValue
    }
  });
}

function defaultCompletionSummary(status: "completed" | "failed") {
  return status === "completed"
    ? "Claude Code reported that the approved skill body completed."
    : "Claude Code reported that the approved skill body failed.";
}

function serializeClaudeAttempt(attempt: {
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
  return {
    ...recordFrom(existing),
    ...next
  } as Prisma.InputJsonValue;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  return value as Prisma.InputJsonValue;
}
