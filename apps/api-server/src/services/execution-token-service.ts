import { createHash, randomBytes } from "node:crypto";
import { Prisma, type ExecutionToken, type PrismaClient, type RiskLevel } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createId } from "./id";
import { resolvedSkillId } from "./object-utils";

const DEFAULT_TTL_SECONDS = 600;

export type IssueExecutionTokenInput = {
  skillRunId: string;
  approvalId?: string | undefined;
  requestedBy?: string | undefined;
  ttlSeconds?: number | undefined;
};

type SkillVersionLike = {
  execution: unknown;
};

export type ExecutionTokenRequirementRun = {
  riskLevel: RiskLevel | null;
  skill?: {
    skillId: string;
    versions?: SkillVersionLike[];
  } | null;
};

export function executionTokenRequired(run: ExecutionTokenRequirementRun): boolean {
  if (run.riskLevel === "high" || run.riskLevel === "critical") return true;

  return Boolean(
    run.skill?.versions?.some((version) => {
      const execution = version.execution as Record<string, unknown>;
      return execution.live_requires_execution_token === true;
    })
  );
}

export function scopesForSkill(skillId: string, environment?: string | null): string[] {
  if (skillId === "deploy-production") return ["deploy:production"];
  if (skillId === "deploy-staging") return ["deploy:staging"];
  if (skillId === "run-db-migration") return [`database:migrate:${environment ?? "unknown"}`];
  if (skillId === "merge-pr") return ["git:merge"];
  return [`skill:${skillId}:execute`];
}

export function hashExecutionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function issueExecutionToken(prisma: PrismaClient, input: IssueExecutionTokenInput) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.skillRun.findUnique({
      where: { id: input.skillRunId },
      include: {
        approvalRequest: true,
        skill: {
          include: {
            versions: true
          }
        },
        executionTokens: {
          where: {
            status: "issued",
            expiresAt: {
              gt: new Date()
            }
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (!run) {
      return { status: 404 as const, body: { error: "Skill run not found" } };
    }

    if (run.status === "denied" || run.decision === "DENY") {
      await emitCredentialRejected(tx, run, "Skill run was denied");
      return { status: 403 as const, body: { error: "Execution token rejected because run was denied" } };
    }

    const isRetryToken = run.status === "failed";

    if (["execution_queued", "executing", "completed", "rolled_back"].includes(run.status)) {
      await emitCredentialRejected(tx, run, "Skill run is already finalized or executing");
      return { status: 409 as const, body: { error: "Execution token rejected because run is not token-eligible" } };
    }

    if (input.approvalId && run.approvalRequest?.id !== input.approvalId) {
      await emitCredentialRejected(tx, run, "Approval request does not match skill run");
      return { status: 400 as const, body: { error: "Approval request does not match skill run" } };
    }

    if ((executionTokenRequired(run) || run.approvalRequest) && run.approvalRequest?.status !== "approved") {
      await emitCredentialRejected(tx, run, "Approved approval request is required");
      return { status: 403 as const, body: { error: "Execution token requires an approved request" } };
    }

    const skillId = run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot);
    const scopes = scopesForSkill(skillId, run.environment);
    const existing = run.executionTokens[0];

    if (existing) {
      await tx.skillRun.update({
        where: { id: run.id },
        data: { status: isRetryToken ? "failed" : "credential_issued" }
      });

      return {
        status: 200 as const,
        body: {
          execution_token: serializeExecutionToken(existing, scopes, input.ttlSeconds ?? DEFAULT_TTL_SECONDS)
        }
      };
    }

    const ttlSeconds = Math.max(1, Math.min(input.ttlSeconds ?? DEFAULT_TTL_SECONDS, DEFAULT_TTL_SECONDS));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const rawToken = randomBytes(32).toString("base64url");
    const token = await tx.executionToken.create({
      data: {
        id: createId("exec_tok"),
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        approvalRequestId: run.approvalRequest?.id ?? null,
        tokenHash: hashExecutionToken(rawToken),
        scopes: scopes as Prisma.InputJsonValue,
        environment: run.environment,
        status: "issued",
        expiresAt
      }
    });

    await tx.skillRun.update({
      where: { id: run.id },
      data: { status: isRetryToken ? "failed" : "credential_issued" }
    });

    if (isRetryToken) {
      await emitAuditEvent(tx, {
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        traceId: run.traceId,
        eventType: "credential.reissued",
        actorType: "system",
        actorId: input.requestedBy ?? "system",
        metadata: {
          execution_token_id: token.id,
          token_status: token.status,
          scopes,
          previous_status: "failed"
        }
      });
    }

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "credential.issued",
      actorType: "system",
      actorId: input.requestedBy ?? "system",
      metadata: {
        execution_token_id: token.id,
        token_status: token.status,
        scopes,
        expires_at: token.expiresAt.toISOString()
      }
    });

    return {
      status: 201 as const,
      body: {
        execution_token: serializeExecutionToken(token, scopes, ttlSeconds)
      }
    };
  });
}

function serializeExecutionToken(token: ExecutionToken, scopes: string[], ttlSeconds: number) {
  return {
    execution_token_id: token.id,
    skill_run_id: token.skillRunId,
    approval_id: token.approvalRequestId,
    scopes,
    ttl_seconds: ttlSeconds,
    status: token.status,
    expires_at: token.expiresAt.toISOString()
  };
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
