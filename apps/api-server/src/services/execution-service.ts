import { Prisma, type ExecutionToken, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { buildExecutionEnvelope } from "./execution-envelope-service";
import { createId } from "./id";
import { executionTokenRequired, hashExecutionToken, scopesForSkill } from "./execution-token-service";
import { recordFrom, resolvedSkillId, stringFrom } from "./object-utils";

export type QueueExecutionInput = {
  runId: string;
  executionTokenId?: string | undefined;
  executionToken?: string | undefined;
  idempotencyKey: string;
  requestedBy?: string | undefined;
  allowRetry?: boolean | undefined;
};

export async function queueSkillRunExecution(prisma: PrismaClient, input: QueueExecutionInput) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.skillRun.findUnique({
      where: { id: input.runId },
      include: {
        agent: true,
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

    const isRetry = input.allowRetry === true && run.status === "failed";

    if (["execution_queued", "executing", "completed", "rolled_back"].includes(run.status) || (run.status === "failed" && !isRetry)) {
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
    const fingerprintError = validateApprovedSkillFingerprint(run);
    if (fingerprintError) {
      await emitExecutionRejected(tx, run, fingerprintError);
      return { status: 409 as const, body: { error: fingerprintError } };
    }
    const tokenRequired = executionTokenRequired(run);
    let executionToken: ExecutionToken | null = null;
    let credentialMode: "bearer" | "legacy_token_id" | "not_required" = "not_required";

    if (tokenRequired) {
      if (!input.executionToken && !input.executionTokenId) {
        await emitCredentialRejected(tx, run, "Execution token is required");
        return { status: 403 as const, body: { error: "Execution rejected because execution token is required" } };
      }

      if (!input.executionToken && input.executionTokenId && !legacyTokenIdExecutionAllowed()) {
        await emitCredentialRejected(tx, run, "Raw bearer execution token is required");
        return { status: 403 as const, body: { error: "Raw bearer execution token is required for token-gated execution" } };
      }

      const validation = await validateExecutionToken(tx, {
        tokenId: input.executionTokenId,
        rawToken: input.executionToken,
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
      credentialMode = input.executionToken ? "bearer" : "legacy_token_id";
    } else if (input.executionTokenId) {
      executionToken = await tx.executionToken.findUnique({
        where: { id: input.executionTokenId }
      });
      credentialMode = executionToken ? "legacy_token_id" : "not_required";
    } else if (input.executionToken) {
      executionToken = await tx.executionToken.findFirst({
        where: {
          skillRunId: run.id,
          tokenHash: hashExecutionToken(input.executionToken)
        }
      });
      credentialMode = executionToken ? "bearer" : "not_required";
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

    const executionEnvelope = buildExecutionEnvelope({
      run,
      skillId,
      executionToken,
      idempotencyKey: input.idempotencyKey,
      credentialMode
    });

    const attempt = await tx.skillRunAttempt.create({
      data: {
        id: createId("attempt"),
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        executionTokenId: executionToken?.id ?? null,
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        result: {
          execution_envelope: executionEnvelope
        } as Prisma.InputJsonValue
      }
    });

    await tx.skillRun.update({
      where: { id: run.id },
      data: { status: "execution_queued" }
    });

    if (isRetry) {
      await emitAuditEvent(tx, {
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        traceId: run.traceId,
        eventType: "execution.retry_requested",
        actorType: "system",
        actorId: input.requestedBy ?? "system",
        metadata: {
          attempt_id: attempt.id,
          idempotency_key: input.idempotencyKey,
          execution_token_id: executionToken?.id ?? null,
          credential_mode: credentialMode,
          execution_envelope: executionEnvelope
        }
      });
    }

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
        credential_mode: credentialMode,
        token_status: executionToken ? "used" : "not_required",
        execution_envelope: executionEnvelope
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

export function validateApprovedSkillFingerprint(run: {
  resolvedSkillSnapshot: unknown;
  skill?: {
    versions?: Array<{
      id: string;
      version: string;
      status: string;
      config: unknown;
    }>;
  } | null;
}) {
  const snapshot = recordFrom(run.resolvedSkillSnapshot);
  const fingerprint = recordFrom(snapshot.source_fingerprint);
  const approvedVersionId = stringFrom(fingerprint.skill_version_id);
  const approvedHash = stringFrom(fingerprint.content_hash);
  if (!approvedVersionId || !approvedHash) return null;

  const version = run.skill?.versions?.find((candidate) => candidate.id === approvedVersionId);
  if (!version) return "Approved skill version is no longer present in the registry";
  if (version.status !== "active") return "Approved skill version is no longer active; re-approval is required";

  const config = recordFrom(version.config);
  const source = recordFrom(config.source);
  const currentHash = stringFrom(source.content_hash);
  if (currentHash && currentHash !== approvedHash) {
    return "Approved skill version hash changed; re-approval is required";
  }

  return null;
}

function legacyTokenIdExecutionAllowed() {
  if (process.env.AGENTGATE_ALLOW_LEGACY_TOKEN_ID === "true") return true;
  if (process.env.AGENTGATE_ALLOW_LEGACY_TOKEN_ID === "false") return false;
  return process.env.NODE_ENV === "test";
}

async function validateExecutionToken(
  prisma: Prisma.TransactionClient,
  input: {
    tokenId?: string | undefined;
    rawToken?: string | undefined;
    runId: string;
    approvalId: string | null;
    environment: string | null;
    requiredScopes: string[];
  }
): Promise<{ valid: true; token: ExecutionToken } | { valid: false; reason: string }> {
  const token = input.rawToken
    ? await prisma.executionToken.findFirst({
        where: {
          skillRunId: input.runId,
          tokenHash: hashExecutionToken(input.rawToken)
        }
      })
    : input.tokenId
      ? await prisma.executionToken.findUnique({
          where: { id: input.tokenId }
        })
      : null;

  if (!token) return { valid: false, reason: "Execution token not found" };
  if (input.tokenId && token.id !== input.tokenId) return { valid: false, reason: "Execution token credential mismatch" };
  if (token.skillRunId !== input.runId) return { valid: false, reason: "Execution token does not match skill run" };
  if (token.approvalRequestId !== input.approvalId) {
    return { valid: false, reason: "Execution token does not match approval request" };
  }
  if (token.environment !== input.environment) return { valid: false, reason: "Execution token does not match environment" };
  if (token.status === "used") return { valid: false, reason: "Execution token has already been used" };
  if (token.status === "revoked") return { valid: false, reason: "Execution token has been revoked" };
  if (token.status === "expired") return { valid: false, reason: "Execution token has expired" };
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
