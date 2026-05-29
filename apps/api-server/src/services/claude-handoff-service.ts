import { Prisma, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import {
  validateApprovedSkillFingerprint,
  validateExecutionTokenCredential
} from "./execution-service";
import { issueExecutionToken, scopesForSkill } from "./execution-token-service";
import { recordFrom, resolvedSkillId, stringFrom } from "./object-utils";
import { createId } from "./id";
import { loadApprovedSkillExecutionSnapshot } from "./approved-skill-snapshot-service";
import { buildClaudeExecutionPacket } from "./claude-execution-packet-service";

const DEFAULT_API_BASE_URL = "http://localhost:4000";
const CLAUDE_SOURCE_TYPES = new Set(["claude_skill", "claude_command", "claude_subagent"]);

export type CreateClaudeHandoffInput = {
  runId: string;
  requestedBy?: string | undefined;
  ttlSeconds?: number | undefined;
  apiBaseUrl?: string | undefined;
};

export type ContinueClaudeHandoffInput = {
  runId: string;
  executionToken: string;
  idempotencyKey?: string | undefined;
  requestedBy?: string | undefined;
  apiBaseUrl?: string | undefined;
};

export async function createClaudeHandoff(prisma: PrismaClient, input: CreateClaudeHandoffInput) {
  const validation = await validateClaudeRunForHandoff(prisma, input.runId);
  if (!validation.valid) return validation.response;

  const tokenResult = await issueExecutionToken(prisma, {
    skillRunId: input.runId,
    approvalId: validation.run.approvalRequest?.id,
    requestedBy: input.requestedBy ?? "agentgate-ui",
    ttlSeconds: input.ttlSeconds,
    includeTokenValue: true,
    forceNew: true
  });

  if (!("execution_token" in tokenResult.body) || !tokenResult.body.execution_token.token_value) {
    return {
      status: tokenResult.status,
      body: tokenResult.body
    };
  }

  const token = tokenResult.body.execution_token;
  const rawToken = token.token_value;
  if (!rawToken) {
    return {
      status: 500 as const,
      body: { error: "Claude handoff failed to create a raw one-time token" }
    };
  }
  const command = buildClaudeContinueCommand({
    apiBaseUrl: input.apiBaseUrl ?? process.env.AGENTGATE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    runId: input.runId,
    token: rawToken
  });

  await emitAuditEvent(prisma, {
    tenantId: validation.run.tenantId,
    workspaceId: validation.run.workspaceId,
    skillRunId: validation.run.id,
    traceId: validation.run.traceId,
    eventType: "claude_handoff.created",
    actorType: "system",
    actorId: input.requestedBy ?? "agentgate-ui",
    metadata: {
      execution_token_id: token.execution_token_id,
      source_type: validation.sourceType,
      skill_id: validation.skillId,
      token_value_returned_once: true
    }
  });

  return {
    status: tokenResult.status,
    body: {
      claude_handoff: {
        run_id: validation.run.id,
        trace_id: validation.run.traceId,
        status: "ready",
        command,
        instructions:
          "Paste this command into Claude Code from the AgentGate workspace. Claude will verify the approved run and one-time token with AgentGate, receive the exact approved skill body, then execute it locally through Claude Code.",
        skill: {
          skill_id: validation.skillId,
          name: validation.run.skill?.name ?? validation.skillId,
          source_type: validation.sourceType,
          approved_hash: validation.approvedHash,
          version: validation.approvedVersion
        },
        execution_token: token,
        safety: {
          approval_status: validation.run.approvalRequest?.status ?? "not_required",
          token_scope: token.scopes,
          token_expires_at: token.expires_at,
          skill_hash_verified: true,
          raw_token_returned_once: true
        }
      }
    }
  };
}

export async function continueClaudeHandoff(prisma: PrismaClient, input: ContinueClaudeHandoffInput) {
  const validation = await validateClaudeRunForHandoff(prisma, input.runId);
  if (!validation.valid) return validation.response;

  const snapshotResult = await loadApprovedSkillExecutionSnapshot(prisma, {
    skillVersionId: validation.approvedVersionId,
    expectedSourceHash: validation.approvedHash
  });
  if (!snapshotResult.ok) return { status: snapshotResult.status, body: { error: snapshotResult.error } };

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

    if (!run) return { status: 404 as const, body: { error: "Skill run not found" } };
    if (run.status !== validation.run.status || run.approvalRequest?.status !== validation.run.approvalRequest?.status) {
      const latestValidation = await validateClaudeRunForHandoff(tx, input.runId);
      if (!latestValidation.valid) return latestValidation.response;
    }

    const skillId = run.skill?.skillId ?? validation.skillId;
    const requiredScopes = scopesForSkill(skillId, run.environment);
    const tokenValidation = await validateExecutionTokenCredential(tx, {
      rawToken: input.executionToken,
      runId: run.id,
      approvalId: run.approvalRequest?.id ?? null,
      environment: run.environment,
      requiredScopes
    });

    if (!tokenValidation.valid) {
      await emitCredentialRejected(tx, run, tokenValidation.reason);
      return { status: 403 as const, body: { error: tokenValidation.reason } };
    }

    const used = await tx.executionToken.updateMany({
      where: {
        id: tokenValidation.token.id,
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

    const idempotencyKey = input.idempotencyKey ?? `claude-handoff-${input.runId}`;
    const executionPacket = buildClaudeExecutionPacket({
      run,
      skillId,
      sourceType: validation.sourceType,
      approvedHash: validation.approvedHash,
      approvedVersion: validation.approvedVersion,
      approvedVersionId: validation.approvedVersionId,
      token: tokenValidation.token,
      snapshot: snapshotResult.snapshot
    });
    const now = new Date();
    const attempt = await tx.skillRunAttempt.create({
      data: {
        id: createId("attempt"),
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        executionTokenId: tokenValidation.token.id,
        idempotencyKey,
        status: "executing",
        claimedByRunnerId: "claude-code",
        heartbeatAt: now,
        startedAt: now,
        result: {
          claude_execution_packet: {
            version: executionPacket.version,
            skill_id: executionPacket.skill.skill_id,
            skill_version: executionPacket.skill.version,
            approved_hash: executionPacket.skill.approved_hash,
            entrypoint_content_hash: executionPacket.skill.entrypoint_content_hash,
            source_type: executionPacket.skill.source_type,
            issued_to: "claude-code"
          }
        } as Prisma.InputJsonValue
      }
    });

    await tx.skillRun.update({
      where: { id: run.id },
      data: { status: "executing" }
    });

    await appendExecutionLog(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      message: "Claude Code execution packet issued for approved skill body.",
      metadata: {
        attempt_id: attempt.id,
        skill_id: skillId,
        source_type: validation.sourceType,
        approved_hash: validation.approvedHash
      }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "claude_handoff.continued",
      actorType: "agent",
      actorId: input.requestedBy ?? "claude-code",
      metadata: {
        source_type: validation.sourceType,
        skill_id: skillId,
        attempt_id: attempt.id,
        execution_token_id: tokenValidation.token.id,
        packet_version: executionPacket.version,
        entrypoint_content_hash: executionPacket.skill.entrypoint_content_hash
      }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "execution.started",
      actorType: "agent",
      actorId: input.requestedBy ?? "claude-code",
      metadata: {
        attempt_id: attempt.id,
        connector: "claude-code",
        skill_id: skillId,
        execution_token_id: tokenValidation.token.id,
        token_status: "used"
      }
    });

    return {
      status: 200 as const,
      body: {
        claude_handoff: {
          run_id: input.runId,
          status: "execution_packet_issued",
          skill_id: skillId,
          source_type: validation.sourceType,
          attempt_id: attempt.id,
          logs_url: `/api/v1/skill-runs/${run.id}/logs`,
          completion_command: buildClaudeCompletionCommand({
            apiBaseUrl: input.apiBaseUrl ?? process.env.AGENTGATE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
            runId: input.runId,
            status: "completed"
          }),
          failure_command: buildClaudeCompletionCommand({
            apiBaseUrl: input.apiBaseUrl ?? process.env.AGENTGATE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
            runId: input.runId,
            status: "failed"
          }),
          completion_instructions:
            "After executing the approved skill body, call the completion command. If execution fails, call the failure command with a short summary."
        },
        execution_packet: executionPacket
      }
    };
  });
}

function buildClaudeContinueCommand(input: { apiBaseUrl: string; runId: string; token: string }) {
  return [
    `AGENTGATE_API_BASE_URL=${shellQuote(input.apiBaseUrl)}`,
    "pnpm exec agentgate claude continue",
    `--run-id ${shellQuote(input.runId)}`,
    `--token ${shellQuote(input.token)}`
  ].join(" ");
}

function buildClaudeCompletionCommand(input: { apiBaseUrl: string; runId: string; status: "completed" | "failed" }) {
  return [
    `AGENTGATE_API_BASE_URL=${shellQuote(input.apiBaseUrl)}`,
    "pnpm exec agentgate claude complete",
    `--run-id ${shellQuote(input.runId)}`,
    `--status ${shellQuote(input.status)}`
  ].join(" ");
}

async function validateClaudeRunForHandoff(prisma: PrismaClient | Prisma.TransactionClient, runId: string) {
  const run = await prisma.skillRun.findUnique({
    where: { id: runId },
    include: {
      approvalRequest: true,
      skill: {
        include: {
          versions: {
            orderBy: { createdAt: "desc" }
          }
        }
      }
    }
  });

  if (!run) {
    return {
      valid: false as const,
      response: { status: 404 as const, body: { error: "Skill run not found" } }
    };
  }

  const sourceType = claudeSourceTypeForRun(run.resolvedSkillSnapshot, run.skill?.versions[0]?.config);
  if (!sourceType) {
    return {
      valid: false as const,
      response: { status: 400 as const, body: { error: "Claude handoff requires an imported Claude skill, command, or subagent" } }
    };
  }

  if (run.decision === "DENY" || run.status === "denied") {
    return {
      valid: false as const,
      response: { status: 403 as const, body: { error: "Claude handoff rejected because the run was denied" } }
    };
  }

  if ((run.riskLevel === "high" || run.riskLevel === "critical" || run.approvalRequest) && run.approvalRequest?.status !== "approved") {
    return {
      valid: false as const,
      response: { status: 403 as const, body: { error: "Claude handoff requires an approved run" } }
    };
  }

  if (["execution_queued", "executing", "completed", "rolled_back"].includes(run.status)) {
    return {
      valid: false as const,
      response: { status: 409 as const, body: { error: "Claude handoff rejected because the run is already executing or finalized" } }
    };
  }

  const fingerprintError = validateApprovedSkillFingerprint(run);
  if (fingerprintError) {
    return {
      valid: false as const,
      response: { status: 409 as const, body: { error: fingerprintError } }
    };
  }

  const fingerprint = recordFrom(recordFrom(run.resolvedSkillSnapshot).source_fingerprint);
  const approvedVersionId = stringFrom(fingerprint.skill_version_id);
  if (!approvedVersionId) {
    return {
      valid: false as const,
      response: { status: 409 as const, body: { error: "Approved imported Claude skill is missing a version fingerprint; re-approval is required" } }
    };
  }
  const approvedVersion = run.skill?.versions.find((version) => version.id === approvedVersionId)?.version ?? run.skill?.versions[0]?.version ?? null;

  return {
    valid: true as const,
    run,
    sourceType,
    skillId: run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot),
    approvedVersionId,
    approvedHash: stringFrom(fingerprint.content_hash),
    approvedVersion
  };
}

function claudeSourceTypeForRun(snapshot: unknown, config: unknown) {
  const fingerprint = recordFrom(recordFrom(snapshot).source_fingerprint);
  const fingerprintSource = stringFrom(fingerprint.source_type);
  if (fingerprintSource && CLAUDE_SOURCE_TYPES.has(fingerprintSource)) return fingerprintSource;

  const configSource = stringFrom(recordFrom(recordFrom(config).source).type);
  if (configSource && CLAUDE_SOURCE_TYPES.has(configSource)) return configSource;

  return null;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
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
