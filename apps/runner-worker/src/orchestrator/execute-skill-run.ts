import type { ExecutionResult, SkillConnector, SkillInput } from "@agentgate/connector-sdk";
import { Prisma, type ExecutionLog, type PrismaClient } from "@prisma/client";
import { emitRunnerAuditEvent } from "../audit/emit-audit-event";
import { dbDemoConnector } from "../connectors/db-demo-connector";
import { deploymentDemoConnector } from "../connectors/deployment-demo-connector";
import { githubDemoConnector } from "../connectors/github-demo-connector";
import { appendExecutionLog } from "../logs/append-execution-log";

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
  const connectorName = connectorNameForSkill(skillId);
  const token = run.executionTokens[0] ?? null;
  const scopes = Array.isArray(token?.scopes) ? token.scopes.filter((scope): scope is string => typeof scope === "string") : [];

  if (attempt) {
    await prisma.skillRunAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "executing",
        startedAt: attempt.startedAt ?? new Date()
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
    for (const log of plannedLogs(run.rawAction, skillId, connectorName, scopes)) {
      await appendLogAndAudit(prisma, run, log.level, log.message, log.metadata);
    }

    const connector = connectorForSkill(skillId);
    const input: SkillInput = {
      skill_id: skillId,
      raw_action: run.rawAction,
      context: run.context as Record<string, unknown>
    };
    const validation = await connector.validateInputs(input);

    if (!validation.valid) {
      return markRunFailed(prisma, run, attempt?.id ?? null, {
        status: "failed",
        summary: "Connector input validation failed.",
        metadata: { errors: validation.errors }
      });
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
      return markRunFailed(prisma, run, attempt?.id ?? null, result);
    }

    await appendLogAndAudit(prisma, run, "info", result.summary, {
      connector: connectorName,
      result_status: result.status
    });

    const normalized = normalizeExecutionResult(run.id, skillId, connectorName, result);

    if (attempt) {
      await prisma.skillRunAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "completed",
          result: normalized as Prisma.InputJsonValue,
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
    });
  }
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
  result: ExecutionResult
) {
  const skillId = run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot);
  const normalized = normalizeExecutionResult(run.id, skillId, connectorNameForSkill(skillId), result);

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

function connectorNameForSkill(skillId: string): string {
  if (skillId === "deploy-production" || skillId === "deploy-staging") return "deployment-demo-connector";
  if (skillId === "run-db-migration" || skillId === "drop-table") return "db-demo-connector";
  return "github-demo-connector";
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

function resolvedSkillId(snapshot: unknown): string {
  if (snapshot && typeof snapshot === "object" && "skill_id" in snapshot) {
    const value = (snapshot as { skill_id?: unknown }).skill_id;
    return typeof value === "string" ? value : "unknown";
  }

  return "unknown";
}
