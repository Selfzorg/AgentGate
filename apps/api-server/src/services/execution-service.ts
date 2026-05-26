import { Prisma, type ExecutionToken, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createId } from "./id";
import { executionTokenRequired, scopesForSkill } from "./execution-token-service";

export type QueueExecutionInput = {
  runId: string;
  executionTokenId?: string | undefined;
  idempotencyKey: string;
  requestedBy?: string | undefined;
};

export async function queueSkillRunExecution(prisma: PrismaClient, input: QueueExecutionInput) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.skillRun.findUnique({
      where: { id: input.runId },
      include: {
        approvalRequest: true,
        skill: {
          include: {
            versions: true
          }
        }
      }
    });

    if (!run) {
      return { status: 404 as const, body: { error: "Skill run not found" } };
    }

    const existingAttempt = await tx.skillRunAttempt.findUnique({
      where: {
        skillRunId_idempotencyKey: {
          skillRunId: run.id,
          idempotencyKey: input.idempotencyKey
        }
      }
    });

    if (existingAttempt) {
      return {
        status: 200 as const,
        body: {
          status: "duplicate",
          run_id: run.id,
          attempt_id: existingAttempt.id,
          original_run_status: run.status,
          logs_url: `/api/v1/skill-runs/${run.id}/logs`
        }
      };
    }

    if (run.status === "denied" || run.approvalRequest?.status === "denied") {
      await emitExecutionRejected(tx, run, "Execution rejected because approval was denied");
      return { status: 403 as const, body: { error: "Execution rejected because approval was denied" } };
    }

    if (["execution_queued", "executing", "completed", "failed", "rolled_back"].includes(run.status)) {
      await emitExecutionRejected(tx, run, "Execution rejected because run is not queueable");
      return { status: 409 as const, body: { error: "Execution rejected because run is not queueable" } };
    }

    if (
      (run.riskLevel === "high" || run.riskLevel === "critical" || run.approvalRequest) &&
      run.approvalRequest?.status !== "approved"
    ) {
      await emitExecutionRejected(tx, run, "Execution rejected because approval is required");
      return { status: 403 as const, body: { error: "Execution rejected because approval is required" } };
    }

    const skillId = run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot);
    const tokenRequired = executionTokenRequired(run);
    let executionToken: ExecutionToken | null = null;

    if (tokenRequired) {
      if (!input.executionTokenId) {
        await emitCredentialRejected(tx, run, "Execution token is required");
        return { status: 403 as const, body: { error: "Execution rejected because execution token is required" } };
      }

      const validation = await validateExecutionToken(tx, {
        tokenId: input.executionTokenId,
        runId: run.id,
        approvalId: run.approvalRequest?.id ?? null,
        environment: run.environment,
        requiredScopes: scopesForSkill(skillId, run.environment)
      });

      if (!validation.valid) {
        await emitCredentialRejected(tx, run, validation.reason);
        return { status: 403 as const, body: { error: validation.reason } };
      }

      executionToken = validation.token;
    } else if (input.executionTokenId) {
      executionToken = await tx.executionToken.findUnique({
        where: { id: input.executionTokenId }
      });
    }

    if (executionToken) {
      const used = await tx.executionToken.updateMany({
        where: {
          id: executionToken.id,
          status: "issued",
          expiresAt: {
            gt: new Date()
          }
        },
        data: {
          status: "used",
          usedAt: new Date()
        }
      });

      if (used.count !== 1) {
        await emitCredentialRejected(tx, run, "Execution token is no longer valid");
        return { status: 403 as const, body: { error: "Execution token is no longer valid" } };
      }
    }

    const attempt = await tx.skillRunAttempt.create({
      data: {
        id: createId("attempt"),
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        executionTokenId: executionToken?.id ?? null,
        idempotencyKey: input.idempotencyKey,
        status: "queued"
      }
    });

    await tx.skillRun.update({
      where: { id: run.id },
      data: { status: "execution_queued" }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "execution.queued",
      actorType: "system",
      actorId: input.requestedBy ?? "system",
      metadata: {
        attempt_id: attempt.id,
        idempotency_key: input.idempotencyKey,
        execution_token_id: executionToken?.id ?? null,
        token_status: executionToken ? "used" : "not_required"
      }
    });

    return {
      status: 202 as const,
      body: {
        run_id: run.id,
        status: "execution_queued",
        attempt_id: attempt.id,
        logs_url: `/api/v1/skill-runs/${run.id}/logs`
      }
    };
  });
}

async function validateExecutionToken(
  prisma: Prisma.TransactionClient,
  input: {
    tokenId: string;
    runId: string;
    approvalId: string | null;
    environment: string | null;
    requiredScopes: string[];
  }
): Promise<{ valid: true; token: ExecutionToken } | { valid: false; reason: string }> {
  const token = await prisma.executionToken.findUnique({
    where: { id: input.tokenId }
  });

  if (!token) return { valid: false, reason: "Execution token not found" };
  if (token.skillRunId !== input.runId) return { valid: false, reason: "Execution token does not match skill run" };
  if (token.approvalRequestId !== input.approvalId) {
    return { valid: false, reason: "Execution token does not match approval request" };
  }
  if (token.environment !== input.environment) return { valid: false, reason: "Execution token does not match environment" };
  if (token.status !== "issued") return { valid: false, reason: "Execution token is not issued" };
  if (token.expiresAt <= new Date()) {
    await prisma.executionToken.update({
      where: { id: token.id },
      data: { status: "expired" }
    });
    return { valid: false, reason: "Execution token has expired" };
  }

  const scopes = Array.isArray(token.scopes) ? token.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  const missingScopes = input.requiredScopes.filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) return { valid: false, reason: "Execution token is missing required scope" };

  return { valid: true, token };
}

async function emitCredentialRejected(
  prisma: Prisma.TransactionClient,
  run: {
    tenantId: string;
    workspaceId: string;
    id: string;
    traceId: string;
  },
  reason: string
) {
  await emitAuditEvent(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    traceId: run.traceId,
    eventType: "credential.rejected",
    actorType: "system",
    actorId: "system",
    metadata: {
      reason,
      token_status: "rejected"
    }
  });
}

async function emitExecutionRejected(
  prisma: Prisma.TransactionClient,
  run: {
    tenantId: string;
    workspaceId: string;
    id: string;
    traceId: string;
  },
  reason: string
) {
  await emitAuditEvent(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    traceId: run.traceId,
    eventType: "execution.rejected",
    actorType: "system",
    actorId: "system",
    metadata: {
      reason
    }
  });
}

function resolvedSkillId(snapshot: unknown): string {
  if (snapshot && typeof snapshot === "object" && "skill_id" in snapshot) {
    const value = (snapshot as { skill_id?: unknown }).skill_id;
    return typeof value === "string" ? value : "unknown";
  }

  return "unknown";
}
