import { Prisma, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { upsertEvidenceArtifactCache } from "./evidence-artifact-cache-service";
import { evidenceForCompletedTask, evidenceSkillFromTask } from "./evidence-task-builders";
import { serializeApproval, serializeEvidenceTask, serializeGateCheck } from "./evidence-task-presenters";
import { ACTIVE_EVIDENCE_TASK_STATUSES, type EvidenceStatus } from "./evidence-task-types";

export async function finishEvidenceTask(
  prisma: PrismaClient,
  input: {
    taskId: string;
    agentId: string;
    taskStatus: "succeeded" | "failed";
    gateStatus: EvidenceStatus;
    reason: string;
    result: Record<string, unknown>;
    error?: Record<string, unknown> | undefined;
  }
) {
  const task = await prisma.evidenceTask.findUnique({
    where: { id: input.taskId },
    include: {
      skillRun: {
        include: { skill: true }
      },
      gateCheckResult: true
    }
  });
  if (!task) return { status: 404 as const, body: { error: "Evidence task not found" } };
  if (task.claimedByAgentId !== input.agentId || (task.status !== "claimed" && task.status !== "running")) {
    return { status: 409 as const, body: { error: "Evidence task is not held by this agent" } };
  }
  if (task.leaseExpiresAt && task.leaseExpiresAt.getTime() < Date.now()) {
    return { status: 409 as const, body: { error: "Evidence task lease expired" } };
  }

  const evidenceSkill = evidenceSkillFromTask(task);
  const evidence = evidenceForCompletedTask({
    task,
    evidenceSkill,
    gateStatus: input.gateStatus,
    reason: input.reason,
    result: input.result,
    agentId: input.agentId
  });

  const completion = await prisma.$transaction(async (tx) => {
    const updatedTask = await tx.evidenceTask.update({
      where: { id: task.id },
      data: {
        status: input.taskStatus,
        result: input.result as Prisma.InputJsonValue,
        error: (input.error ?? {}) as Prisma.InputJsonValue,
        completedAt: new Date(),
        leaseExpiresAt: null
      }
    });

    await tx.gateCheckResult.update({
      where: { id: task.gateCheckResultId },
      data: {
        status: input.gateStatus,
        evidence: evidence as Prisma.InputJsonValue
      }
    });

    await upsertEvidenceArtifactCache(tx, {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      checkKey: task.checkKey,
      context: task.skillRun.context,
      environment: task.skillRun.environment,
      status: input.gateStatus,
      reason: input.reason,
      evidence,
      sourceTaskId: task.id
    });

    const readiness = await updateApprovalReadiness(tx, task.skillRunId);

    return {
      task: updatedTask,
      readiness
    };
  });

  await emitAuditEvent(prisma, {
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    skillRunId: task.skillRunId,
    traceId: task.traceId,
    eventType: input.taskStatus === "succeeded" ? "evidence.task.completed" : "evidence.task.failed",
    actorType: "agent",
    actorId: input.agentId,
    metadata: {
      evidence_task_id: task.id,
      check_key: task.checkKey,
      runtime: task.runtime,
      evidence_status: input.gateStatus,
      reason: input.reason
    }
  });

  await emitAuditEvent(prisma, {
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    skillRunId: task.skillRunId,
    traceId: task.traceId,
    eventType: `evidence.collection.${input.gateStatus}`,
    actorType: "agent",
    actorId: input.agentId,
    metadata: {
      check_key: task.checkKey,
      reason: input.reason,
      attempt: task.attempt,
      evidence_task_id: task.id,
      evidence_skill_id: task.evidenceSkillId,
      selected_runtime: task.runtime
    }
  });

  if (completion.readiness.collectionCompleted) {
    await emitAuditEvent(prisma, {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      skillRunId: task.skillRunId,
      traceId: task.traceId,
      eventType: "evidence.collection.completed",
      actorType: "system",
      actorId: "evidence_task_service",
      metadata: {
        readiness: completion.readiness.readiness,
        missing_checks: completion.readiness.missingChecks
      }
    });
  }

  return {
    status: 200 as const,
    body: {
      evidence_task: serializeEvidenceTask(completion.task),
      approval: completion.readiness.approval ? serializeApproval(completion.readiness.approval, completion.readiness.missingChecks) : null,
      gate_checks: completion.readiness.gateChecks.map(serializeGateCheck),
      missing_checks: completion.readiness.missingChecks
    }
  };
}

export async function updateApprovalReadiness(prisma: Prisma.TransactionClient, skillRunId: string) {
  await prisma.$queryRaw`SELECT id FROM "skill_runs" WHERE id = ${skillRunId} FOR UPDATE`;

  const [run, gateChecks, activeTasks] = await Promise.all([
    prisma.skillRun.findUniqueOrThrow({
      where: { id: skillRunId },
      include: { approvalRequest: true }
    }),
    prisma.gateCheckResult.findMany({
      where: { skillRunId },
      orderBy: { checkKey: "asc" }
    }),
    prisma.evidenceTask.count({
      where: {
        skillRunId,
        status: { in: [...ACTIVE_EVIDENCE_TASK_STATUSES] }
      }
    })
  ]);

  const missingChecks = gateChecks.filter((check) => check.status !== "passed").map((check) => check.checkKey);
  const readiness = activeTasks > 0 ? "collecting" : missingChecks.length === 0 ? "ready" : "blocked";
  const evidenceSummary = {
    source: "evidence_pipeline",
    mode: "async_evidence_tasks",
    collected_at: new Date().toISOString(),
    active_tasks: activeTasks,
    checks: gateChecks.map((check) => ({
      check_key: check.checkKey,
      status: check.status,
      evidence: check.evidence
    }))
  };

  const approval = run.approvalRequest
    ? await prisma.approvalRequest.update({
        where: { id: run.approvalRequest.id },
        data: {
          approvalReadiness: readiness,
          missingChecks: missingChecks as Prisma.InputJsonValue,
          evidence: evidenceSummary as Prisma.InputJsonValue
        }
      })
    : null;

  await prisma.skillRun.update({
    where: { id: skillRunId },
    data: {
      status: activeTasks > 0 ? "approval_pending" : "approval_required"
    }
  });

  return {
    approval,
    gateChecks,
    missingChecks,
    readiness,
    collectionCompleted: activeTasks === 0
  };
}

export async function nextTaskAttempt(prisma: PrismaClient, gateCheckResultId: string): Promise<number> {
  const aggregate = await prisma.evidenceTask.aggregate({
    where: { gateCheckResultId },
    _max: { attempt: true }
  });
  return (aggregate._max.attempt ?? 0) + 1;
}
