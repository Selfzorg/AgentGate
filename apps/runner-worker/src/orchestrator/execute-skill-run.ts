import type { ExecutionResult, SkillConnector, SkillInput } from "@agentgate/connector-sdk";
import { Prisma, type ExecutionLog, type PrismaClient } from "@prisma/client";
import { emitRunnerAuditEvent } from "../audit/emit-audit-event";
import { dbDemoConnector } from "../connectors/db-demo-connector";
import { deploymentDemoConnector } from "../connectors/deployment-demo-connector";
import { githubDemoConnector } from "../connectors/github-demo-connector";
import { appendExecutionLog } from "../logs/append-execution-log";
import { validateExecutionControls } from "./execution-controls";

export type ConnectorRunContext = {
  id: string;
  traceId: string;
  rawAction: string;
  context: unknown;
  resolvedSkillSnapshot: unknown;
  skill?: { skillId: string } | null;
};

export async function executeSkillRun(prisma: PrismaClient, runId: string) {
  const run = await prisma.skillRun.findUnique({
    where: { id: runId },
    include: {
      agent: true,
      skill: true,
      executionTokens: {
        where: { status: "used" },
        orderBy: { usedAt: "desc" },
        take: 1
      },
      skillRunAttempts: {
        where: {
          status: {
            in: ["queued", "executing"]
          }
        },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!run) return { run_id: runId, status: "missing" as const };

  const attempt = run.skillRunAttempts[0] ?? null;
  const skillId = run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot);
  const connectorName = connectorNameForRun(run.resolvedSkillSnapshot, skillId);
  const token = run.executionTokens[0] ?? null;
  const scopes = Array.isArray(token?.scopes) ? token.scopes.filter((scope): scope is string => typeof scope === "string") : [];

  if (attempt) {
    const now = new Date();
    await prisma.skillRunAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "executing",
        claimedByRunnerId: "in_process_runner",
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        heartbeatAt: now,
        startedAt: attempt.startedAt ?? now
      }
    });
  }

  await emitRunnerAuditEvent(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    traceId: run.traceId,
    eventType: "execution.started",
    metadata: {
      attempt_id: attempt?.id ?? null,
      connector: connectorName,
      skill_id: skillId,
      execution_token_id: token?.id ?? null,
      token_status: token ? "used" : "not_required"
    }
  });

  try {
    const controls = validateExecutionControls({
      skillId,
      connectorName,
      environment: run.environment,
      token
    });
    if (!controls.allowed) {
      return markRunFailed(prisma, run, attempt?.id ?? null, {
        status: "failed",
        summary: controls.reason,
        metadata: controls.metadata
      }, connectorName);
    }

    for (const log of plannedLogs(run.rawAction, skillId, connectorName, scopes)) {
      await appendLogAndAudit(prisma, run, log.level, log.message, log.metadata);
    }

    const connector = connectorForRun(run.resolvedSkillSnapshot, skillId, connectorName);
    const input = skillInputForRun(run, skillId);
    const validation = await connector.validateInputs(input);

    if (!validation.valid) {
      return markRunFailed(prisma, run, attempt?.id ?? null, {
        status: "failed",
        summary: "Connector input validation failed.",
        metadata: { errors: validation.errors }
      }, connectorName);
    }

    const result = await connector.execute(input, {
      skill_run_id: run.id,
      trace_id: run.traceId,
      metadata: {
        connector: connectorName,
        execution_token_id: token?.id ?? null,
        scopes
      }
    });

    if (result.status === "failed") {
      return markRunFailed(prisma, run, attempt?.id ?? null, result, connectorName);
    }

    await appendLogAndAudit(prisma, run, "info", result.summary, {
      connector: connectorName,
      result_status: result.status
    });

    const normalized = normalizeExecutionResult(run.id, skillId, connectorName, result);
    const attemptResult = mergeAttemptResult(attempt?.result, normalized);

    if (attempt) {
      await prisma.skillRunAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "completed",
          result: attemptResult as Prisma.InputJsonValue,
          leaseExpiresAt: null,
          heartbeatAt: new Date(),
          completedAt: new Date()
        }
      });
    }

    await prisma.skillRun.update({
      where: { id: run.id },
      data: { status: "completed" }
    });

    await emitRunnerAuditEvent(prisma, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "execution.completed",
      metadata: normalized
    });
    await emitRunnerAuditEvent(prisma, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "audit.finalized",
      metadata: {
        final_status: "completed",
        run_id: run.id
      }
    });

    return { run_id: run.id, status: "completed" as const, result: normalized };
  } catch (error) {
    return markRunFailed(prisma, run, attempt?.id ?? null, {
      status: "failed",
      summary: error instanceof Error ? error.message : "Connector execution failed."
    }, connectorName);
  }
}

export async function dryRunSkillConnector(run: ConnectorRunContext) {
  const skillId = run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot);
  const connectorName = connectorNameForRun(run.resolvedSkillSnapshot, skillId);
  const connector = connectorForRun(run.resolvedSkillSnapshot, skillId, connectorName);
  const input = skillInputForRun(run, skillId);
  const validation = await connector.validateInputs(input);

  if (!validation.valid) {
    return {
      skillId,
      connectorName,
      result: {
        status: "failed" as const,
        summary: "Connector input validation failed.",
        artifacts: [],
        metadata: { errors: validation.errors }
      }
    };
  }

  const result = await connector.dryRun(input, {
    skill_run_id: run.id,
    trace_id: run.traceId,
    metadata: {
      connector: connectorName,
      dry_run: true
    }
  });

  return { skillId, connectorName, result };
}

async function markRunFailed(
  prisma: PrismaClient,
  run: {
    id: string;
    tenantId: string;
    workspaceId: string;
    traceId: string;
    skill?: { skillId: string } | null;
    resolvedSkillSnapshot: unknown;
  },
  attemptId: string | null,
  result: ExecutionResult,
  connectorName = connectorNameForSkill(run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot))
) {
  const skillId = run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot);
  const normalized = normalizeExecutionResult(run.id, skillId, connectorName, result);

  await appendLogAndAudit(prisma, run, "error", result.summary, {
    result_status: "failed",
    metadata: result.metadata ?? {}
  });

  if (attemptId) {
    await prisma.skillRunAttempt.update({
      where: { id: attemptId },
      data: {
        status: "failed",
        error: normalized as Prisma.InputJsonValue,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
        completedAt: new Date()
      }
    });
  }

  await prisma.skillRun.update({
    where: { id: run.id },
    data: { status: "failed" }
  });

  await emitRunnerAuditEvent(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    traceId: run.traceId,
    eventType: "execution.failed",
    metadata: normalized
  });
  await emitRunnerAuditEvent(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    traceId: run.traceId,
    eventType: "audit.finalized",
    metadata: {
      final_status: "failed",
      run_id: run.id
    }
  });

  return { run_id: run.id, status: "failed" as const, result: normalized };
}

async function appendLogAndAudit(
  prisma: PrismaClient,
  run: {
    id: string;
    tenantId: string;
    workspaceId: string;
    traceId: string;
  },
  level: ExecutionLog["level"],
  message: string,
  metadata: Record<string, unknown>
) {
  const log = await appendExecutionLog(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    level,
    message,
    metadata
  });

  await emitRunnerAuditEvent(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    traceId: run.traceId,
    eventType: "execution.log_emitted",
    metadata: {
      log_id: log.id,
      sequence: log.sequence,
      level: log.level,
      message: log.message
    }
  });

  return log;
}

function plannedLogs(
  rawAction: string,
  skillId: string,
  connectorName: string,
  scopes: string[]
): Array<{ level: ExecutionLog["level"]; message: string; metadata: Record<string, unknown> }> {
  if (skillId === "deploy-production" || skillId === "deploy-staging") {
    return [
      {
        level: "info",
        message: "Starting deployment connector",
        metadata: { connector: connectorName }
      },
      {
        level: "info",
        message: rawAction.includes("checkout-api") ? "Validating service checkout-api" : "Validating service target",
        metadata: { connector: connectorName }
      },
      {
        level: "info",
        message: scopes.length > 0 ? `Using scoped token ${scopes.join(", ")}` : "No execution token required",
        metadata: { connector: connectorName, token_status: scopes.length > 0 ? "used" : "not_required" }
      },
      {
        level: "info",
        message: "Rollout plan accepted",
        metadata: { connector: connectorName }
      }
    ];
  }

  if (skillId === "run-db-migration") {
    return [
      { level: "info", message: "Starting database connector", metadata: { connector: connectorName } },
      { level: "info", message: "Validating schema diff artifact", metadata: { connector: connectorName } },
      {
        level: "info",
        message: scopes.length > 0 ? `Using scoped token ${scopes.join(", ")}` : "No execution token required",
        metadata: { connector: connectorName, token_status: scopes.length > 0 ? "used" : "not_required" }
      },
      { level: "info", message: "Migration lock window accepted", metadata: { connector: connectorName } }
    ];
  }

  return [
    { level: "info", message: `Starting ${connectorName}`, metadata: { connector: connectorName } },
    { level: "info", message: `Executing ${skillId}`, metadata: { connector: connectorName } }
  ];
}

function connectorForSkill(skillId: string): SkillConnector {
  if (skillId === "deploy-production" || skillId === "deploy-staging") return deploymentDemoConnector;
  if (skillId === "run-db-migration" || skillId === "drop-table") return dbDemoConnector;
  return githubDemoConnector;
}

function connectorForRun(snapshot: unknown, skillId: string, connectorName: string): SkillConnector {
  if (importedSourceType(snapshot)) return headlessAgentAdapterConnector(connectorName, importedSourceType(snapshot)!);
  return connectorForSkill(skillId);
}

function connectorNameForSkill(skillId: string): string {
  if (skillId === "deploy-production" || skillId === "deploy-staging") return "deployment-demo-connector";
  if (skillId === "run-db-migration" || skillId === "drop-table") return "db-demo-connector";
  return "github-demo-connector";
}

function connectorNameForRun(snapshot: unknown, skillId: string): string {
  const sourceType = importedSourceType(snapshot);
  if (sourceType === "mcp_tool") return "mcp-tool-adapter";
  if (sourceType === "native_connector") return "native-connector-adapter";
  if (sourceType === "claude_skill" || sourceType === "claude_command" || sourceType === "claude_subagent") return "claude-cli-adapter";
  if (sourceType === "codex_skill") return "codex-cli-adapter";
  return connectorNameForSkill(skillId);
}

function skillInputForRun(run: ConnectorRunContext, skillId: string): SkillInput {
  return {
    skill_id: skillId,
    raw_action: run.rawAction,
    context: run.context && typeof run.context === "object" && !Array.isArray(run.context) ? (run.context as Record<string, unknown>) : {}
  };
}

function importedSourceType(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const sourceFingerprint = (snapshot as { source_fingerprint?: unknown }).source_fingerprint;
  if (!sourceFingerprint || typeof sourceFingerprint !== "object" || Array.isArray(sourceFingerprint)) return null;
  const value = (sourceFingerprint as { source_type?: unknown }).source_type;
  return typeof value === "string" ? value : null;
}

function headlessAgentAdapterConnector(connectorName: string, sourceType: string): SkillConnector {
  return {
    async validateInputs(input) {
      if (input.raw_action.trim().length === 0) return { valid: false, errors: ["raw_action is required"] };
      return { valid: true, errors: [] };
    },
    async dryRun() {
      return {
        summary: `${connectorName} dry-run is represented by the approved AgentGate envelope.`,
        artifacts: []
      };
    },
    async execute(input, context) {
      if (process.env.AGENTGATE_ENABLE_LIVE_AGENT_ADAPTERS === "true") {
        return {
          status: "failed",
          summary: `${connectorName} live adapter is intentionally not enabled in the MVP runtime.`,
          metadata: {
            connector: connectorName,
            source_type: sourceType,
            skill_run_id: context.skill_run_id
          }
        };
      }

      return {
        status: "completed",
        summary: `${connectorName} governed handoff simulated for imported ${sourceType} skill.`,
        metadata: {
          connector: connectorName,
          source_type: sourceType,
          live_adapter_enabled: false,
          original_action: input.raw_action
        }
      };
    }
  };
}

function normalizeExecutionResult(
  runId: string,
  skillId: string,
  connectorName: string,
  result: ExecutionResult
) {
  return {
    run_id: runId,
    skill_id: skillId,
    connector: connectorName,
    status: result.status,
    summary: result.summary,
    metadata: result.metadata ?? {}
  };
}

function mergeAttemptResult(existing: unknown, result: ReturnType<typeof normalizeExecutionResult>) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  return {
    ...base,
    execution_result: result
  };
}

function resolvedSkillId(snapshot: unknown): string {
  if (snapshot && typeof snapshot === "object" && "skill_id" in snapshot) {
    const value = (snapshot as { skill_id?: unknown }).skill_id;
    return typeof value === "string" ? value : "unknown";
  }

  return "unknown";
}
