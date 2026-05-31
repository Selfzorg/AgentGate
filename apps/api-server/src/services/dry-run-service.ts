import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { dryRunSkillConnector } from "@agentgate/runner-worker";
import { normalizeEvidenceTaskSpecs } from "@agentgate/skill-registry";
import { Prisma, type PrismaClient, type RiskLevel } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createOrUpdateApprovalRequest } from "./approval-service";
import { createEvidenceTasksForRun } from "./evidence-task-service";
import { createGateCheckResults } from "./gate-check-service";
import { createId } from "./id";
import { recordFrom, resolvedSkillId, stringFrom } from "./object-utils";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

type ConnectorDryRunResult = {
  status?: "completed" | "failed" | string | undefined;
  summary?: string | undefined;
  artifacts?: unknown;
  metadata?: unknown;
  context_updates?: unknown;
  required_checks?: unknown;
};

type DryRunServiceRun = Prisma.SkillRunGetPayload<{
  include: {
    agent: true;
    skill: {
      include: {
        versions: true;
      };
    };
    dryRunResult: true;
    approvalRequest: true;
  };
}>;

export async function runDryRun({
  prisma,
  runId,
  requestedBy = "system",
  configDir = join(repoRoot, "configs")
}: {
  prisma: PrismaClient;
  runId: string;
  requestedBy?: string;
  configDir?: string;
}) {
  const run = await prisma.skillRun.findUnique({
    where: { id: runId },
    include: {
      agent: true,
      skill: {
        include: {
          versions: {
            where: { status: "active" },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      },
      dryRunResult: true,
      approvalRequest: true
    }
  });

  if (!run) {
    return { status: 404 as const, body: { error: "Skill run not found" } };
  }

  if (
    run.status === "approved" ||
    run.status === "denied" ||
    run.approvalRequest?.status === "approved" ||
    run.approvalRequest?.status === "denied"
  ) {
    return { status: 409 as const, body: { error: "Dry-run cannot be started for a finalized approval" } };
  }

  const skillId = run.skill?.skillId ?? resolvedSkillId(run.resolvedSkillSnapshot);
  const activeConfig = recordFrom(run.skill?.versions[0]?.config);
  const snapshot = recordFrom(run.resolvedSkillSnapshot);
  const dryRunConfig = dryRunConfigForRun(activeConfig, snapshot);
  if (!dryRunIsSupported(activeConfig, snapshot, dryRunConfig)) {
    return {
      status: 400 as const,
      body: {
        error: "Skill does not support dry-run",
        skill_id: skillId
      }
    };
  }

  await markDryRunStarted(prisma, {
    run,
    skillId,
    requestedBy
  });

  let connectorDryRun: Awaited<ReturnType<typeof dryRunSkillConnector>>;
  try {
    connectorDryRun = await dryRunSkillConnector(run);
  } catch (error) {
    const failedResult = await persistDryRunFailure(prisma, {
      run,
      skillId,
      connectorName: "unknown",
      requestedBy,
      reason: error instanceof Error ? error.message : String(error)
    });
    return {
      status: 500 as const,
      body: {
        error: "Dry-run failed",
        dry_run_result: failedResult
      }
    };
  }

  const payload = normalizeDryRunPayload({
    skillId: connectorDryRun.skillId,
    connectorName: connectorDryRun.connectorName,
    result: connectorDryRun.result
  });

  if (payload.status !== "completed") {
    const failedResult = await persistDryRunFailure(prisma, {
      run,
      skillId,
      connectorName: connectorDryRun.connectorName,
      requestedBy,
      reason: payload.summary,
      payload
    });
    return {
      status: 500 as const,
      body: {
        error: "Dry-run failed",
        dry_run_result: failedResult
      }
    };
  }

  const completion = await persistDryRunCompletion(prisma, {
    run,
    skillId,
    dryRunConfig,
    payload,
    requestedBy,
    configDir
  });

  let evidenceCollection: Awaited<ReturnType<typeof createEvidenceTasksForRun>> | null = null;
  if (completion.approvalCreated && completion.requiredChecks.length > 0) {
    evidenceCollection = await createEvidenceTasksForRun({
      prisma,
      runId: run.id,
      requestedBy: "dry-run-service"
    });
  }

  return {
    status: 200 as const,
    body: {
      dry_run_result: completion.dryRunResult,
      decision: completion.decision,
      missing_checks: evidenceCollection?.status === 202 ? evidenceCollection.body.missing_checks : completion.missingChecks,
      ...(evidenceCollection?.status === 202
        ? {
            approval: evidenceCollection.body.approval,
            gate_checks: evidenceCollection.body.gate_checks,
            evidence_tasks: evidenceCollection.body.evidence_tasks
          }
        : {})
    }
  };
}

async function markDryRunStarted(
  prisma: PrismaClient,
  input: {
    run: DryRunServiceRun;
    skillId: string;
    requestedBy: string;
  }
) {
  await prisma.$transaction(async (tx) => {
    await tx.skillRun.update({
      where: { id: input.run.id },
      data: { status: "dry_run_running" }
    });

    await emitAuditEvent(tx, {
      tenantId: input.run.tenantId,
      workspaceId: input.run.workspaceId,
      skillRunId: input.run.id,
      traceId: input.run.traceId,
      eventType: "dry_run.started",
      actorType: "system",
      actorId: input.requestedBy,
      metadata: {
        skill_id: input.skillId
      }
    });
  });
}

async function persistDryRunFailure(
  prisma: PrismaClient,
  input: {
    run: DryRunServiceRun;
    skillId: string;
    connectorName: string;
    requestedBy: string;
    reason: string;
    payload?: NormalizedDryRunPayload | undefined;
  }
) {
  const payload =
    input.payload ??
    normalizeDryRunPayload({
      skillId: input.skillId,
      connectorName: input.connectorName,
      result: {
        status: "failed",
        summary: input.reason,
        artifacts: [],
        metadata: {
          error: input.reason
        }
      }
    });

  const dryRunResult = await prisma.$transaction(async (tx) => {
    const result = await upsertDryRunResult(tx, input.run, payload);
    await tx.skillRun.update({
      where: { id: input.run.id },
      data: {
        status: "dry_run_required",
        reason: `Dry-run failed: ${payload.summary}`
      }
    });
    await emitAuditEvent(tx, {
      tenantId: input.run.tenantId,
      workspaceId: input.run.workspaceId,
      skillRunId: input.run.id,
      traceId: input.run.traceId,
      eventType: "dry_run.failed",
      actorType: "system",
      actorId: input.requestedBy,
      metadata: {
        dry_run_result_id: result.id,
        connector: input.connectorName,
        reason: payload.summary
      }
    });
    return result;
  });

  return serializeDryRunResult(dryRunResult);
}

async function persistDryRunCompletion(
  prisma: PrismaClient,
  input: {
    run: DryRunServiceRun;
    skillId: string;
    dryRunConfig: Record<string, unknown>;
    payload: NormalizedDryRunPayload;
    requestedBy: string;
    configDir: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    const dryRunResult = await upsertDryRunResult(tx, input.run, input.payload);
    const nextContext = {
      ...recordFrom(input.run.context),
      dry_run_completed: true,
      dry_run_result_id: dryRunResult.id,
      dry_run_status: input.payload.status,
      dry_run_summary: input.payload.summary,
      ...input.payload.context_updates
    };
    const fixtures = await loadDemoFixtures(input.configDir);
    const postDryRunPolicy = evaluatePolicy({
      rules: fixtures.policies.rules,
      role: input.run.agent?.role ?? "db_agent",
      skill_id: input.skillId,
      risk_level: input.run.riskLevel ?? ("critical" as RiskLevel),
      context: nextContext
    });
    const dryRunEvidenceTasks = normalizeEvidenceTaskSpecs(input.dryRunConfig.evidence_tasks ?? input.dryRunConfig.evidenceTasks).tasks;
    const requiredChecks = normalizeCheckKeys([
      ...postDryRunPolicy.required_checks,
      ...stringArray(input.dryRunConfig.required_checks ?? input.dryRunConfig.requiredChecks),
      ...input.payload.required_checks,
      ...dryRunEvidenceTasks.map((task) => task.check_key)
    ]);
    const missingChecks = requiredChecks;
    const nextResolvedSkillSnapshot = {
      ...recordFrom(input.run.resolvedSkillSnapshot),
      supports_dry_run: true,
      dry_run: input.dryRunConfig,
      required_checks: normalizeCheckKeys([...stringArray(recordFrom(input.run.resolvedSkillSnapshot).required_checks), ...requiredChecks]),
      evidence_tasks: mergeEvidenceTasks(recordFrom(input.run.resolvedSkillSnapshot).evidence_tasks, dryRunEvidenceTasks)
    };

    await createGateCheckResults(tx, {
      tenantId: input.run.tenantId,
      workspaceId: input.run.workspaceId,
      skillRunId: input.run.id,
      skillId: input.skillId,
      requiredChecks,
      evidenceTasks: dryRunEvidenceTasks,
      context: nextContext,
      mode: "pending"
    });

    await tx.skillRun.update({
      where: { id: input.run.id },
      data: {
        context: nextContext as Prisma.InputJsonValue,
        status: postDryRunPolicy.decision === "REQUIRE_APPROVAL" ? "approval_required" : "dry_run_completed",
        decision: postDryRunPolicy.decision,
        reason: postDryRunPolicy.reason,
        resolvedSkillSnapshot: nextResolvedSkillSnapshot as Prisma.InputJsonValue,
        policySnapshot: {
          ...recordFrom(input.run.policySnapshot),
          post_dry_run_decision: postDryRunPolicy.decision,
          post_dry_run_reason: postDryRunPolicy.reason,
          required_checks: requiredChecks,
          approvers: postDryRunPolicy.approvers,
          missing_checks: missingChecks,
          dry_run_result_id: dryRunResult.id,
          dry_run_connector: input.payload.connector
        } as Prisma.InputJsonValue
      }
    });

    await emitAuditEvent(tx, {
      tenantId: input.run.tenantId,
      workspaceId: input.run.workspaceId,
      skillRunId: input.run.id,
      traceId: input.run.traceId,
      eventType: "dry_run.completed",
      actorType: "system",
      actorId: input.requestedBy,
      metadata: {
        dry_run_result_id: dryRunResult.id,
        result: input.payload,
        post_dry_run_decision: postDryRunPolicy.decision,
        missing_checks: missingChecks
      }
    });

    let approvalCreated = false;
    if (postDryRunPolicy.decision === "REQUIRE_APPROVAL") {
      const approval = await createOrUpdateApprovalRequest(tx, {
        tenantId: input.run.tenantId,
        workspaceId: input.run.workspaceId,
        skillRunId: input.run.id,
        traceId: input.run.traceId,
        riskLevel: input.run.riskLevel ?? ("critical" as RiskLevel),
        missingChecks,
        requiredApprovers: postDryRunPolicy.approvers,
        approvalReadiness: requiredChecks.length > 0 ? "collecting" : undefined,
        evidence: {
          dry_run_result_id: dryRunResult.id,
          dry_run: input.payload,
          policy_reason: postDryRunPolicy.reason,
          required_checks: requiredChecks
        }
      });
      approvalCreated = true;

      await emitAuditEvent(tx, {
        tenantId: input.run.tenantId,
        workspaceId: input.run.workspaceId,
        skillRunId: input.run.id,
        traceId: input.run.traceId,
        eventType: "approval.requested",
        actorType: "system",
        actorId: input.requestedBy,
        metadata: {
          approval_id: approval.id,
          source: "post_dry_run_policy",
          missing_checks: missingChecks
        }
      });
    }

    return {
      dryRunResult: serializeDryRunResult(dryRunResult),
      decision: postDryRunPolicy.decision,
      missingChecks,
      requiredChecks,
      approvalCreated
    };
  });
}

async function upsertDryRunResult(
  prisma: Prisma.TransactionClient,
  run: DryRunServiceRun,
  payload: NormalizedDryRunPayload
) {
  return prisma.dryRunResult.upsert({
    where: { skillRunId: run.id },
    create: {
      id: createId("dry"),
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      status: payload.status,
      summary: payload.summary,
      result: payload as Prisma.InputJsonValue,
      artifacts: payload.artifacts as Prisma.InputJsonValue
    },
    update: {
      status: payload.status,
      summary: payload.summary,
      result: payload as Prisma.InputJsonValue,
      artifacts: payload.artifacts as Prisma.InputJsonValue
    }
  });
}

function normalizeDryRunPayload(input: {
  skillId: string;
  connectorName: string;
  result: ConnectorDryRunResult;
}): NormalizedDryRunPayload {
  const result = recordFrom(input.result);
  const status = input.result.status === "failed" ? "failed" : "completed";
  const summary = stringFrom(input.result.summary) ?? (status === "completed" ? "Dry-run completed." : "Dry-run failed.");
  return {
    status,
    summary,
    connector: input.connectorName,
    skill_id: input.skillId,
    artifacts: recordArray(input.result.artifacts),
    metadata: recordFrom(result.metadata),
    context_updates: recordFrom(result.context_updates),
    required_checks: normalizeCheckKeys(stringArray(result.required_checks))
  };
}

function serializeDryRunResult(result: {
  id: string;
  status: string;
  summary: string;
  result: unknown;
  artifacts: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: result.id,
    status: result.status,
    summary: result.summary,
    result: result.result,
    artifacts: result.artifacts,
    ...(result.createdAt ? { created_at: result.createdAt.toISOString() } : {}),
    ...(result.updatedAt ? { updated_at: result.updatedAt.toISOString() } : {})
  };
}

function dryRunConfigForRun(activeConfig: Record<string, unknown>, snapshot: Record<string, unknown>) {
  return {
    ...recordFrom(snapshot.dry_run ?? snapshot.dryRun),
    ...recordFrom(activeConfig.dry_run ?? activeConfig.dryRun)
  };
}

function dryRunIsSupported(
  activeConfig: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  dryRunConfig: Record<string, unknown>
) {
  return (
    booleanFrom(activeConfig.supports_dry_run ?? activeConfig.supportsDryRun) ||
    booleanFrom(snapshot.supports_dry_run ?? snapshot.supportsDryRun) ||
    Object.keys(dryRunConfig).length > 0
  );
}

function mergeEvidenceTasks(existing: unknown, dryRunTasks: Array<{ check_key: string }>) {
  const existingTasks = Array.isArray(existing) ? existing.filter((task) => task && typeof task === "object" && !Array.isArray(task)) : [];
  const seen = new Set<string>();
  return [...existingTasks, ...dryRunTasks].filter((task) => {
    const checkKey = stringFrom((task as { check_key?: unknown }).check_key);
    if (!checkKey) return true;
    if (seen.has(checkKey)) return false;
    seen.add(checkKey);
    return true;
  });
}

function normalizeCheckKeys(values: string[]) {
  return [
    ...new Set(
      values
        .map((value) =>
          value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
        )
        .filter(Boolean)
    )
  ];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const resolved = stringFrom(entry);
      return resolved ? [resolved] : [];
    });
  }
  const resolved = stringFrom(value);
  return resolved ? [resolved] : [];
}

function booleanFrom(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];
}

type NormalizedDryRunPayload = {
  status: "completed" | "failed";
  summary: string;
  connector: string;
  skill_id: string;
  artifacts: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  context_updates: Record<string, unknown>;
  required_checks: string[];
};
