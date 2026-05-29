import type { PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { queueSkillRunExecution, validateApprovedSkillFingerprint } from "./execution-service";
import { issueExecutionToken } from "./execution-token-service";
import { recordFrom, resolvedSkillId, stringFrom } from "./object-utils";

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
          "Paste this command into Claude Code from the AgentGate workspace. Claude will verify the approved run and one-time token with AgentGate before queueing execution.",
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

  const result = await queueSkillRunExecution(prisma, {
    runId: input.runId,
    executionToken: input.executionToken,
    idempotencyKey: input.idempotencyKey ?? `claude-handoff-${input.runId}`,
    requestedBy: input.requestedBy ?? "claude-code"
  });

  if (result.status === 202 || result.status === 200) {
    await emitAuditEvent(prisma, {
      tenantId: validation.run.tenantId,
      workspaceId: validation.run.workspaceId,
      skillRunId: validation.run.id,
      traceId: validation.run.traceId,
      eventType: "claude_handoff.continued",
      actorType: "agent",
      actorId: input.requestedBy ?? "claude-code",
      metadata: {
        source_type: validation.sourceType,
        skill_id: validation.skillId,
        queue_status: result.body.status
      }
    });
  }

  return {
    status: result.status,
    body: {
      claude_handoff: {
        run_id: input.runId,
        status: result.body.status,
        skill_id: validation.skillId,
        source_type: validation.sourceType,
        logs_url: "logs_url" in result.body ? result.body.logs_url : null
      },
      execution: result.body
    }
  };
}

function buildClaudeContinueCommand(input: { apiBaseUrl: string; runId: string; token: string }) {
  return [
    `AGENTGATE_API_BASE_URL=${shellQuote(input.apiBaseUrl)}`,
    "pnpm exec agentgate claude continue",
    `--run-id ${shellQuote(input.runId)}`,
    `--token ${shellQuote(input.token)}`
  ].join(" ");
}

async function validateClaudeRunForHandoff(prisma: PrismaClient, runId: string) {
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

  return {
    valid: true as const,
    run,
    sourceType,
    skillId: run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot),
    approvedHash: stringFrom(fingerprint.content_hash),
    approvedVersion: stringFrom(fingerprint.skill_version) ?? run.skill?.versions[0]?.version ?? null
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
