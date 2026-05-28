import { Prisma, type EvidenceTask, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { executeEvidenceRuntime, subagentForCheck } from "./evidence-runtimes";
import {
  allowedRuntimesForTask,
  evidenceForCompletedTask,
  evidenceSkillFromTask,
  evidenceSkillSnapshot,
  evidenceTaskCreateData,
  preferredRuntime,
  taskAllowsRuntime
} from "./evidence-task-builders";
import { serializeApproval, serializeEvidenceTask, serializeGateCheck } from "./evidence-task-presenters";
import { ACTIVE_EVIDENCE_TASK_STATUSES, type EvidenceStatus, type EvidenceTaskResultInput } from "./evidence-task-types";
import { workerCapabilityClaimError } from "./evidence-worker-capabilities";
import {
  normalizeEvidenceRuntimeId,
  resolveEvidenceSkill
} from "./evidence-skill-registry";
import { mapWithConcurrency, recordFrom, resolvedSkillId, stringFrom } from "./object-utils";

export type { EvidenceTaskResultInput } from "./evidence-task-types";

export async function createEvidenceTasksForRun({
  prisma,
  runId,
  checkKeys,
  requestedBy = "evidence_pipeline"
}: {
  prisma: PrismaClient;
  runId: string;
  checkKeys?: string[] | undefined;
  requestedBy?: string | undefined;
}) {
  const run = await prisma.skillRun.findUnique({
    where: { id: runId },
    include: {
      approvalRequest: true,
      gateCheckResults: {
        orderBy: { checkKey: "asc" }
      },
      skill: true,
      agent: true
    }
  });

  if (!run) return { status: 404 as const, body: { error: "Skill run not found" } };
  if (!run.approvalRequest) return { status: 400 as const, body: { error: "Run does not have an approval request" } };
  if (run.approvalRequest.status !== "pending") {
    return { status: 409 as const, body: { error: "Approval request is not pending" } };
  }

  const requestedCheckKeys = new Set(checkKeys?.filter(Boolean));
  const targetChecks = run.gateCheckResults.filter((check) => requestedCheckKeys.size === 0 || requestedCheckKeys.has(check.checkKey));

  if (targetChecks.length === 0) {
    return {
      status: 404 as const,
      body: {
        error: "No matching gate checks found",
        requested_checks: checkKeys ?? []
      }
    };
  }

  const context = recordFrom(run.context);
  const plans = await Promise.all(
    targetChecks.map(async (check) => {
      const evidenceSkill = await resolveEvidenceSkill({
        prisma,
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        checkKey: check.checkKey
      });
      return {
        check,
        attempt: await nextTaskAttempt(prisma, check.id),
        evidenceSkill,
        selectedRuntime: preferredRuntime(evidenceSkill, context, check.checkKey)
      };
    })
  );

  const result = await prisma.$transaction(async (tx) => {
    await tx.skillRun.update({
      where: { id: run.id },
      data: { status: "approval_pending" }
    });

    await tx.approvalRequest.update({
      where: { id: run.approvalRequest!.id },
      data: {
        approvalReadiness: "collecting",
        missingChecks: run.gateCheckResults
          .filter((check) => check.status !== "passed")
          .map((check) => check.checkKey) as Prisma.InputJsonValue
      }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "evidence.collection.started",
      actorType: "system",
      actorId: requestedBy,
      metadata: {
        mode: "async_evidence_tasks",
        checks: plans.map((plan) => ({
          check_key: plan.check.checkKey,
          evidence_skill_id: plan.evidenceSkill.skillId,
          preferred_runtimes: plan.evidenceSkill.preferredRuntimes
        }))
      }
    });

    const tasks: EvidenceTask[] = [];
    for (const plan of plans) {
      await tx.evidenceTask.updateMany({
        where: {
          gateCheckResultId: plan.check.id,
          status: { in: [...ACTIVE_EVIDENCE_TASK_STATUSES] }
        },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          error: {
            reason: "Superseded by a newer evidence retry."
          } as Prisma.InputJsonValue
        }
      });

      const task = await tx.evidenceTask.create({
        data: evidenceTaskCreateData({
          run,
          check: plan.check,
          attempt: plan.attempt,
          evidenceSkill: plan.evidenceSkill,
          selectedRuntime: plan.selectedRuntime,
          requestedBy
        })
      });
      tasks.push(task);

      const subagent = subagentForCheck(plan.check.checkKey);
      await tx.gateCheckResult.update({
        where: { id: plan.check.id },
        data: {
          status: "running",
          evidence: {
            source: "evidence_task",
            status: "queued",
            reason: `${subagent.role} task is queued for ${plan.selectedRuntime}.`,
            attempt: plan.attempt,
            evidence_task_id: task.id,
            selected_runtime: plan.selectedRuntime,
            subagent,
            evidence_skill: evidenceSkillSnapshot(plan.evidenceSkill)
          } as Prisma.InputJsonValue
        }
      });

      await emitAuditEvent(tx, {
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        traceId: run.traceId,
        eventType: "evidence.task.queued",
        actorType: "system",
        actorId: requestedBy,
        metadata: {
          evidence_task_id: task.id,
          check_key: plan.check.checkKey,
          attempt: plan.attempt,
          selected_runtime: plan.selectedRuntime,
          evidence_skill: evidenceSkillSnapshot(plan.evidenceSkill)
        }
      });
    }

    const allChecks = await tx.gateCheckResult.findMany({
      where: { skillRunId: run.id },
      orderBy: { checkKey: "asc" }
    });
    const missingChecks = allChecks.filter((check) => check.status !== "passed").map((check) => check.checkKey);
    const approval = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: run.approvalRequest!.id }
    });

    return {
      approval,
      gateChecks: allChecks,
      tasks,
      missingChecks
    };
  });

  return {
    status: 202 as const,
    body: {
      approval: serializeApproval(result.approval, result.missingChecks),
      gate_checks: result.gateChecks.map(serializeGateCheck),
      evidence_tasks: result.tasks.map(serializeEvidenceTask),
      missing_checks: result.missingChecks
    }
  };
}

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
  const task = await prisma.evidenceTask.findUnique({ where: { id: taskId } });
  if (!task) return { status: 404 as const, body: { error: "Evidence task not found" } };
  return { status: 200 as const, body: { evidence_task: serializeEvidenceTask(task) } };
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
    const result = await executeEvidenceRuntime({
      checkKey: current.checkKey,
      label: current.label,
      attempt: current.attempt,
      context: {
        ...recordFrom(current.skillRun.context),
        evidence_runtime_overrides: {
          [current.checkKey]: ["local_deterministic"]
        }
      },
      rawAction: current.skillRun.rawAction,
      targetSkillId: stringFrom(inputRecord.target_skill_id) ?? current.skillRun.skill?.skillId ?? resolvedSkillId(current.skillRun.resolvedSkillSnapshot),
      requestedBy: agentId,
      evidenceSkill
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

async function finishEvidenceTask(
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

async function updateApprovalReadiness(prisma: Prisma.TransactionClient, skillRunId: string) {
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

async function nextTaskAttempt(prisma: PrismaClient, gateCheckResultId: string): Promise<number> {
  const aggregate = await prisma.evidenceTask.aggregate({
    where: { gateCheckResultId },
    _max: { attempt: true }
  });
  return (aggregate._max.attempt ?? 0) + 1;
}
