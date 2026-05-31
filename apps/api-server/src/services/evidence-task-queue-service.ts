import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeEvidenceTaskSpecs } from "@agentgate/skill-registry";
import { emitAuditEvent } from "./audit-event-service";
import { executeEvidenceRuntime } from "./evidence-runtimes";
import { allowedRuntimesForTask, evidenceSkillFromTask, taskAllowsRuntime } from "./evidence-task-builders";
import { finishEvidenceTask } from "./evidence-task-completion";
import { serializeEvidenceTask } from "./evidence-task-presenters";
import { ACTIVE_EVIDENCE_TASK_STATUSES, type EvidenceTaskResultInput } from "./evidence-task-types";
import { workerCapabilityClaimError } from "./evidence-worker-capabilities";
import { normalizeEvidenceRuntimeId } from "./evidence-skill-registry";
import { mapWithConcurrency, recordFrom, resolvedSkillId, stringFrom } from "./object-utils";

export async function listPendingEvidenceTasks({
  prisma,
  tenantId,
  workspaceId,
  skillRunId,
  newestFirst = false,
  limit = 10
}: {
  prisma: PrismaClient;
  tenantId?: string | undefined;
  workspaceId?: string | undefined;
  skillRunId?: string | undefined;
  newestFirst?: boolean | undefined;
  limit?: number | undefined;
}) {
  const now = new Date();
  const tasks = await prisma.evidenceTask.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(skillRunId ? { skillRunId } : {}),
      OR: [
        { status: "queued" },
        {
          status: { in: ["claimed", "running"] },
          leaseExpiresAt: { lt: now }
        }
      ]
    },
    orderBy: [{ priority: "desc" }, { createdAt: newestFirst ? "desc" : "asc" }],
    take: limit
  });

  return tasks.map(serializeEvidenceTask);
}

export async function getEvidenceTask(prisma: PrismaClient, taskId: string) {
  const task = await prisma.evidenceTask.findUnique({
    where: { id: taskId },
    include: {
      approvalRequest: true,
      gateCheckResult: true,
      skillRun: {
        include: {
          skill: true,
          matchedPolicy: true
        }
      }
    }
  });
  if (!task) return { status: 404 as const, body: { error: "Evidence task not found" } };
  const events = await prisma.auditEvent.findMany({
    where: {
      traceId: task.traceId,
      OR: [
        { eventType: { startsWith: "evidence." } },
        { eventType: { startsWith: "approval." } },
        { eventType: { startsWith: "dry_run." } }
      ]
    },
    orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
    take: 40
  });

  return {
    status: 200 as const,
    body: {
      evidence_task: {
        ...serializeEvidenceTask(task),
        gate_check: {
          id: task.gateCheckResult.id,
          check_key: task.gateCheckResult.checkKey,
          label: task.gateCheckResult.label,
          status: task.gateCheckResult.status,
          evidence: task.gateCheckResult.evidence
        },
        approval: task.approvalRequest
          ? {
              id: task.approvalRequest.id,
              status: task.approvalRequest.status,
              approval_readiness: task.approvalRequest.approvalReadiness,
              updated_at: task.approvalRequest.updatedAt.toISOString()
            }
          : null,
        skill_run: {
          id: task.skillRun.id,
          trace_id: task.skillRun.traceId,
          raw_action: task.skillRun.rawAction,
          status: task.skillRun.status,
          decision: task.skillRun.decision,
          risk_level: task.skillRun.riskLevel,
          environment: task.skillRun.environment,
          skill_id: task.skillRun.skill?.skillId ?? null,
          skill_name: task.skillRun.skill?.name ?? null,
          matched_policy_id: task.skillRun.matchedPolicy?.policyId ?? null
        },
        audit_events: events.map((event) => ({
          id: event.id,
          skill_run_id: event.skillRunId,
          trace_id: event.traceId,
          event_type: event.eventType,
          actor_type: event.actorType,
          actor_id: event.actorId,
          sequence: event.sequence,
          metadata: event.metadata,
          created_at: event.createdAt.toISOString()
        }))
      }
    }
  };
}

export async function claimEvidenceTask(
  prisma: PrismaClient,
  input: {
    taskId: string;
    agentId: string;
    runtime: string;
    leaseSeconds?: number | undefined;
  }
) {
  const requestedRuntime = normalizeEvidenceRuntimeId(input.runtime);
  if (!requestedRuntime) {
    return { status: 400 as const, body: { error: "Unsupported evidence runtime", runtime: input.runtime } };
  }

  const task = await prisma.evidenceTask.findUnique({ where: { id: input.taskId } });
  if (!task) return { status: 404 as const, body: { error: "Evidence task not found" } };
  if (!taskAllowsRuntime(task, requestedRuntime)) {
    return {
      status: 400 as const,
      body: {
        error: "Evidence task does not allow requested runtime",
        requested_runtime: requestedRuntime,
        allowed_runtimes: allowedRuntimesForTask(task)
      }
    };
  }
  const worker = await prisma.evidenceWorker.findUnique({
    where: {
      tenantId_workspaceId_agentId: {
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
        agentId: input.agentId
      }
    }
  });
  const evidenceSkill = evidenceSkillFromTask(task);
  const capabilityError = workerCapabilityClaimError({
    worker,
    requestedRuntime,
    sideEffectLevel: evidenceSkill.sideEffectLevel
  });
  if (capabilityError) {
    return {
      status: 409 as const,
      body: {
        error: capabilityError,
        requested_runtime: requestedRuntime,
        worker_agent_id: input.agentId
      }
    };
  }

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + Math.max(input.leaseSeconds ?? 60, 5) * 1000);
  const claimed = await prisma.evidenceTask.updateMany({
    where: {
      id: input.taskId,
      OR: [
        { status: "queued" },
        {
          status: { in: ["claimed", "running"] },
          leaseExpiresAt: { lt: now }
        }
      ]
    },
    data: {
      status: "claimed",
      runtime: requestedRuntime,
      claimedByAgentId: input.agentId,
      leaseExpiresAt,
      claimedAt: now,
      startedAt: now
    }
  });

  if (claimed.count !== 1) {
    return { status: 409 as const, body: { error: "Evidence task is not claimable" } };
  }

  const updated = await prisma.evidenceTask.findUniqueOrThrow({ where: { id: input.taskId } });
  await emitAuditEvent(prisma, {
    tenantId: updated.tenantId,
    workspaceId: updated.workspaceId,
    skillRunId: updated.skillRunId,
    traceId: updated.traceId,
    eventType: "evidence.task.claimed",
    actorType: "agent",
    actorId: input.agentId,
    metadata: {
      evidence_task_id: updated.id,
      check_key: updated.checkKey,
      runtime: requestedRuntime,
      lease_expires_at: leaseExpiresAt.toISOString()
    }
  });

  return { status: 200 as const, body: { evidence_task: serializeEvidenceTask(updated) } };
}

export async function heartbeatEvidenceTask(
  prisma: PrismaClient,
  input: {
    taskId: string;
    agentId: string;
    leaseSeconds?: number | undefined;
  }
) {
  const task = await prisma.evidenceTask.findUnique({ where: { id: input.taskId } });
  if (!task) return { status: 404 as const, body: { error: "Evidence task not found" } };
  if (task.claimedByAgentId !== input.agentId || (task.status !== "claimed" && task.status !== "running")) {
    return { status: 409 as const, body: { error: "Evidence task is not held by this agent" } };
  }

  const leaseExpiresAt = new Date(Date.now() + Math.max(input.leaseSeconds ?? 60, 5) * 1000);
  const updated = await prisma.evidenceTask.update({
    where: { id: input.taskId },
    data: {
      status: "running",
      leaseExpiresAt
    }
  });

  return { status: 200 as const, body: { evidence_task: serializeEvidenceTask(updated) } };
}

export async function completeEvidenceTask(
  prisma: PrismaClient,
  input: {
    taskId: string;
    agentId: string;
    result: EvidenceTaskResultInput;
  }
) {
  return finishEvidenceTask(prisma, {
    taskId: input.taskId,
    agentId: input.agentId,
    taskStatus: "succeeded",
    gateStatus: input.result.status,
    reason: input.result.reason,
    result: input.result.evidence ?? {}
  });
}

export async function failEvidenceTask(
  prisma: PrismaClient,
  input: {
    taskId: string;
    agentId: string;
    reason: string;
    error?: Record<string, unknown> | undefined;
  }
) {
  return finishEvidenceTask(prisma, {
    taskId: input.taskId,
    agentId: input.agentId,
    taskStatus: "failed",
    gateStatus: "failed",
    reason: input.reason,
    result: {},
    error: input.error ?? {}
  });
}

export async function prioritizeEvidenceTask(
  prisma: PrismaClient,
  input: {
    taskId: string;
    priority?: number | undefined;
    requestedBy?: string | undefined;
  }
) {
  const task = await prisma.evidenceTask.findUnique({ where: { id: input.taskId } });
  if (!task) return { status: 404 as const, body: { error: "Evidence task not found" } };
  if (!ACTIVE_EVIDENCE_TASK_STATUSES.includes(task.status as (typeof ACTIVE_EVIDENCE_TASK_STATUSES)[number])) {
    return { status: 409 as const, body: { error: "Only active evidence tasks can be prioritized" } };
  }

  const highestPriority = await prisma.evidenceTask.aggregate({
    where: {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      status: { in: [...ACTIVE_EVIDENCE_TASK_STATUSES] }
    },
    _max: { priority: true }
  });
  const requestedPriority = input.priority ?? (highestPriority._max.priority ?? 0) + 10;
  const priority = Math.max(task.priority, Math.min(Math.max(requestedPriority, 1), 10_000));
  const updated = await prisma.evidenceTask.update({
    where: { id: task.id },
    data: { priority }
  });

  await emitAuditEvent(prisma, {
    tenantId: updated.tenantId,
    workspaceId: updated.workspaceId,
    skillRunId: updated.skillRunId,
    traceId: updated.traceId,
    eventType: "evidence.task.prioritized",
    actorType: "user",
    actorId: input.requestedBy ?? "user_service_owner",
    metadata: {
      evidence_task_id: updated.id,
      check_key: updated.checkKey,
      previous_priority: task.priority,
      priority
    }
  });

  return { status: 200 as const, body: { evidence_task: serializeEvidenceTask(updated) } };
}

export async function clearActiveEvidenceQueue(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    skillRunId?: string | undefined;
    requestedBy?: string | undefined;
    reason?: string | undefined;
  }
) {
  const reason = input.reason?.trim() || "Evidence queue cleared by user.";
  const activeTasks = await prisma.evidenceTask.findMany({
    where: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      ...(input.skillRunId ? { skillRunId: input.skillRunId } : {}),
      status: { in: [...ACTIVE_EVIDENCE_TASK_STATUSES] }
    },
    select: {
      id: true,
      skillRunId: true,
      gateCheckResultId: true,
      checkKey: true,
      traceId: true
    }
  });

  if (activeTasks.length === 0) {
    return {
      status: 200 as const,
      body: {
        cancelled_count: 0,
        affected_run_count: 0,
        affected_runs: []
      }
    };
  }

  const now = new Date();
  const affectedRunIds = [...new Set(activeTasks.map((task) => task.skillRunId))];
  const affectedGateCheckIds = [...new Set(activeTasks.map((task) => task.gateCheckResultId))];

  await prisma.$transaction(async (tx) => {
    await tx.evidenceTask.updateMany({
      where: {
        id: { in: activeTasks.map((task) => task.id) },
        status: { in: [...ACTIVE_EVIDENCE_TASK_STATUSES] }
      },
      data: {
        status: "cancelled",
        completedAt: now,
        leaseExpiresAt: null,
        error: {
          reason
        } as Prisma.InputJsonValue
      }
    });

    await tx.gateCheckResult.updateMany({
      where: {
        id: { in: affectedGateCheckIds }
      },
      data: {
        status: "missing",
        evidence: {
          source: "evidence_queue_clear",
          status: "cancelled",
          reason,
          cleared_at: now.toISOString(),
          cleared_by: input.requestedBy ?? "user_service_owner"
        } as Prisma.InputJsonValue
      }
    });

    await tx.approvalRequest.updateMany({
      where: {
        skillRunId: { in: affectedRunIds },
        status: "pending"
      },
      data: {
        approvalReadiness: "blocked"
      }
    });

    await tx.skillRun.updateMany({
      where: {
        id: { in: affectedRunIds },
        status: "approval_pending"
      },
      data: {
        status: "approval_required"
      }
    });

    await emitAuditEvent(tx, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      skillRunId: input.skillRunId ?? null,
      traceId: `evidence.queue.${input.tenantId}.${now.getTime()}`,
      eventType: "evidence.queue.cleared",
      actorType: "user",
      actorId: input.requestedBy ?? "user_service_owner",
      metadata: {
        reason,
        cancelled_count: activeTasks.length,
        affected_run_count: affectedRunIds.length,
        skill_run_id: input.skillRunId ?? null
      }
    });
  });

  return {
    status: 200 as const,
    body: {
      cancelled_count: activeTasks.length,
      affected_run_count: affectedRunIds.length,
      affected_runs: affectedRunIds,
      readiness: []
    }
  };
}

export async function processEvidenceTasksOnce({
  prisma,
  skillRunId,
  limit = 10,
  agentId = "local_deterministic_worker",
  concurrency = 4
}: {
  prisma: PrismaClient;
  skillRunId?: string | undefined;
  limit?: number | undefined;
  agentId?: string | undefined;
  concurrency?: number | undefined;
}) {
  const pending = await listPendingEvidenceTasks({ prisma, skillRunId, limit });
  const outcomes = await mapWithConcurrency(pending, concurrency, async (task) => {
    const claim = await claimEvidenceTask(prisma, {
      taskId: task.id,
      agentId,
      runtime: "local_deterministic",
      leaseSeconds: 60
    });
    if (claim.status !== 200) return { claimed: 0, completed: 0 };

    const current = await prisma.evidenceTask.findUniqueOrThrow({
      where: { id: task.id },
      include: {
        skillRun: {
          include: {
            skill: true
          }
        },
        gateCheckResult: true
      }
    });
    const inputRecord = recordFrom(current.input);
    const evidenceSkill = evidenceSkillFromTask(current);
    const evidenceTaskSpec = normalizeEvidenceTaskSpecs(inputRecord.evidence_task ? [inputRecord.evidence_task] : []).tasks[0];
    const result = await executeEvidenceRuntime({
      checkKey: current.checkKey,
      label: current.label,
      attempt: current.attempt,
      context: {
        ...recordFrom(current.skillRun.context),
        ...(inputRecord.dry_run_result ? { dry_run_result: inputRecord.dry_run_result } : {}),
        ...(inputRecord.dry_run_artifacts ? { dry_run_artifacts: inputRecord.dry_run_artifacts } : {}),
        ...(inputRecord.dry_run_metadata ? { dry_run_metadata: inputRecord.dry_run_metadata } : {}),
        evidence_runtime_overrides: {
          [current.checkKey]: ["local_deterministic"]
        }
      },
      rawAction: current.skillRun.rawAction,
      targetSkillId: stringFrom(inputRecord.target_skill_id) ?? current.skillRun.skill?.skillId ?? resolvedSkillId(current.skillRun.resolvedSkillSnapshot),
      requestedBy: agentId,
      evidenceSkill,
      evidenceTaskSpec
    });

    const completedTask = await completeEvidenceTask(prisma, {
      taskId: current.id,
      agentId,
      result: {
        status: result.status,
        reason: result.reason,
        evidence: result.evidence
      }
    });

    return {
      claimed: 1,
      completed: completedTask.status === 200 ? 1 : 0
    };
  });

  return {
    scanned: pending.length,
    claimed: outcomes.reduce((total, outcome) => total + outcome.claimed, 0),
    completed: outcomes.reduce((total, outcome) => total + outcome.completed, 0)
  };
}
