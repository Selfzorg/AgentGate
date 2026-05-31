import {
  Prisma,
  type AuditEvent,
  type EvidenceTask,
  type EvidenceTaskStatus,
  type EvidenceWorker,
  type EvidenceWorkerStatus,
  type PrismaClient
} from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import {
  capabilitiesForWorker,
  metadataWithCapabilities,
  serializeEvidenceWorkerCapabilities
} from "./evidence-worker-capabilities";
import { createId } from "./id";

const HEARTBEAT_STALE_MS = 90_000;
const taskStatuses: EvidenceTaskStatus[] = ["queued", "claimed", "running", "succeeded", "failed", "timed_out", "cancelled"];

export type EvidenceWorkerHeartbeatInput = {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  runtime: string;
  driver: string;
  status: EvidenceWorkerStatus;
  currentTaskId?: string | null | undefined;
  currentCheckKey?: string | null | undefined;
  processedDelta?: number | undefined;
  failedDelta?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
  capabilities?: Record<string, unknown> | undefined;
};

export async function recordEvidenceWorkerHeartbeat(prisma: PrismaClient, input: EvidenceWorkerHeartbeatInput) {
  const now = new Date();
  const metadata = metadataWithCapabilities({
    runtime: input.runtime,
    metadata: input.metadata,
    capabilities: input.capabilities
  });
  const previous = await prisma.evidenceWorker.findUnique({
    where: {
      tenantId_workspaceId_agentId: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agentId: input.agentId
      }
    }
  });

  const worker = await prisma.evidenceWorker.upsert({
    where: {
      tenantId_workspaceId_agentId: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agentId: input.agentId
      }
    },
    create: {
      id: createId("evw"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      runtime: input.runtime,
      driver: input.driver,
      status: input.status,
      currentTaskId: input.currentTaskId ?? null,
      currentCheckKey: input.currentCheckKey ?? null,
      processedCount: input.processedDelta ?? 0,
      failedCount: input.failedDelta ?? 0,
      metadata: metadata as Prisma.InputJsonValue,
      lastHeartbeatAt: now,
      stoppedAt: null
    },
    update: {
      runtime: input.runtime,
      driver: input.driver,
      status: input.status,
      currentTaskId: input.currentTaskId ?? null,
      currentCheckKey: input.currentCheckKey ?? null,
      processedCount: { increment: input.processedDelta ?? 0 },
      failedCount: { increment: input.failedDelta ?? 0 },
      metadata: metadata as Prisma.InputJsonValue,
      lastHeartbeatAt: now,
      stoppedAt: input.status === "offline" ? now : null
    }
  });

  if (shouldEmitWorkerEvent(previous, worker)) {
    await emitWorkerAuditEvent(prisma, worker, previous ? eventTypeForStatus(worker.status) : "evidence.worker.registered");
  }

  return {
    status: 200 as const,
    body: {
      evidence_worker: serializeEvidenceWorker(worker)
    }
  };
}

export async function markEvidenceWorkerStopped(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    agentId: string;
  }
) {
  const previous = await prisma.evidenceWorker.findUnique({
    where: {
      tenantId_workspaceId_agentId: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agentId: input.agentId
      }
    }
  });

  if (!previous) {
    return { status: 404 as const, body: { error: "Evidence worker not found" } };
  }

  const worker = await prisma.evidenceWorker.update({
    where: { id: previous.id },
    data: {
      status: "offline",
      currentTaskId: null,
      currentCheckKey: null,
      lastHeartbeatAt: new Date(),
      stoppedAt: new Date()
    }
  });

  await emitWorkerAuditEvent(prisma, worker, "evidence.worker.stopped");

  return {
    status: 200 as const,
    body: {
      evidence_worker: serializeEvidenceWorker(worker)
    }
  };
}

export async function getEvidenceMonitor(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    limit?: number | undefined;
    q?: string | undefined;
    taskId?: string | undefined;
    skillRunId?: string | undefined;
    traceId?: string | undefined;
    checkKey?: string | undefined;
    status?: EvidenceTaskStatus | undefined;
    runtime?: string | undefined;
  }
) {
  const taskWhere = evidenceTaskWhere(input);
  const [statusCounts, workers, tasks, events] = await Promise.all([
    prisma.evidenceTask.groupBy({
      by: ["status"],
      where: taskWhere,
      _count: { _all: true }
    }),
    prisma.evidenceWorker.findMany({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId
      },
      orderBy: [{ lastHeartbeatAt: "desc" }, { createdAt: "desc" }],
      take: 25
    }),
    prisma.evidenceTask.findMany({
      where: taskWhere,
      include: {
        approvalRequest: true,
        gateCheckResult: true,
        skillRun: {
          select: {
            id: true,
            rawAction: true,
            status: true,
            decision: true,
            environment: true
          }
        }
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
      take: input.limit ?? 100
    }),
    prisma.auditEvent.findMany({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        eventType: { startsWith: "evidence." },
        ...(input.skillRunId ? { skillRunId: input.skillRunId } : {}),
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.q
          ? {
              OR: [
                { traceId: { contains: input.q, mode: "insensitive" } },
                { skillRunId: { contains: input.q, mode: "insensitive" } },
                { eventType: { contains: input.q, mode: "insensitive" } },
                { actorId: { contains: input.q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
      take: 40
    })
  ]);

  const queueStats = Object.fromEntries(taskStatuses.map((status) => [status, 0])) as Record<EvidenceTaskStatus, number>;
  for (const count of statusCounts) {
    queueStats[count.status] = count._count._all;
  }

  return {
    generated_at: new Date().toISOString(),
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    queue: {
      ...queueStats,
      active: queueStats.queued + queueStats.claimed + queueStats.running,
      terminal: queueStats.succeeded + queueStats.failed + queueStats.timed_out + queueStats.cancelled,
      total: Object.values(queueStats).reduce((sum, count) => sum + count, 0)
    },
    workers: workers.map(serializeEvidenceWorker),
    tasks: tasks.map(serializeMonitorTask),
    events: events.map(serializeMonitorEvent)
  };
}

function evidenceTaskWhere(input: {
  tenantId: string;
  workspaceId: string;
  q?: string | undefined;
  taskId?: string | undefined;
  skillRunId?: string | undefined;
  traceId?: string | undefined;
  checkKey?: string | undefined;
  status?: EvidenceTaskStatus | undefined;
  runtime?: string | undefined;
}): Prisma.EvidenceTaskWhereInput {
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    ...(input.taskId ? { id: input.taskId } : {}),
    ...(input.skillRunId ? { skillRunId: input.skillRunId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.checkKey ? { checkKey: { contains: input.checkKey, mode: "insensitive" } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.runtime ? { runtime: { contains: input.runtime, mode: "insensitive" } } : {}),
    ...(input.q
      ? {
          OR: [
            { id: { contains: input.q, mode: "insensitive" } },
            { skillRunId: { contains: input.q, mode: "insensitive" } },
            { traceId: { contains: input.q, mode: "insensitive" } },
            { checkKey: { contains: input.q, mode: "insensitive" } },
            { label: { contains: input.q, mode: "insensitive" } },
            { runtime: { contains: input.q, mode: "insensitive" } },
            {
              skillRun: {
                is: {
                  rawAction: { contains: input.q, mode: "insensitive" }
                }
              }
            }
          ]
        }
      : {})
  };
}

function shouldEmitWorkerEvent(previous: EvidenceWorker | null, worker: EvidenceWorker) {
  if (!previous) return true;
  return previous.status !== worker.status || previous.currentTaskId !== worker.currentTaskId || previous.currentCheckKey !== worker.currentCheckKey;
}

function eventTypeForStatus(status: EvidenceWorkerStatus) {
  if (status === "busy") return "evidence.worker.busy";
  if (status === "idle") return "evidence.worker.idle";
  if (status === "error") return "evidence.worker.error";
  if (status === "offline") return "evidence.worker.stopped";
  return "evidence.worker.online";
}

async function emitWorkerAuditEvent(prisma: PrismaClient, worker: EvidenceWorker, eventType: string) {
  const task = worker.currentTaskId
    ? await prisma.evidenceTask.findUnique({
        where: { id: worker.currentTaskId }
      })
    : null;

  await emitAuditEvent(prisma, {
    tenantId: worker.tenantId,
    workspaceId: worker.workspaceId,
    skillRunId: task?.skillRunId ?? null,
    traceId: task?.traceId ?? `worker.${worker.id}`,
    eventType,
    actorType: "agent",
    actorId: worker.agentId,
    metadata: {
      evidence_worker_id: worker.id,
      agent_id: worker.agentId,
      runtime: worker.runtime,
      driver: worker.driver,
      status: worker.status,
      current_task_id: worker.currentTaskId,
      current_check_key: worker.currentCheckKey,
      processed_count: worker.processedCount,
      failed_count: worker.failedCount,
      capabilities: serializeEvidenceWorkerCapabilities(capabilitiesForWorker(worker))
    }
  });
}

function serializeEvidenceWorker(worker: EvidenceWorker) {
  const now = Date.now();
  const heartbeatAgeMs = now - worker.lastHeartbeatAt.getTime();
  const stale = worker.status !== "offline" && heartbeatAgeMs > HEARTBEAT_STALE_MS;
  const effectiveStatus = stale ? "offline" : worker.status;
  const capabilities = capabilitiesForWorker(worker);

  return {
    id: worker.id,
    tenant_id: worker.tenantId,
    workspace_id: worker.workspaceId,
    agent_id: worker.agentId,
    runtime: worker.runtime,
    driver: worker.driver,
    status: worker.status,
    effective_status: effectiveStatus,
    stale,
    current_task_id: worker.currentTaskId,
    current_check_key: worker.currentCheckKey,
    processed_count: worker.processedCount,
    failed_count: worker.failedCount,
    capabilities: serializeEvidenceWorkerCapabilities(capabilities),
    metadata: worker.metadata,
    heartbeat_age_ms: heartbeatAgeMs,
    last_heartbeat_at: worker.lastHeartbeatAt.toISOString(),
    started_at: worker.startedAt.toISOString(),
    stopped_at: worker.stoppedAt?.toISOString() ?? null,
    created_at: worker.createdAt.toISOString(),
    updated_at: worker.updatedAt.toISOString()
  };
}

function serializeMonitorTask(
  task: EvidenceTask & {
    approvalRequest: { id: string; status: string; approvalReadiness: string } | null;
    gateCheckResult: { id: string; status: string; evidence: unknown };
    skillRun: {
      id: string;
      rawAction: string;
      status: string;
      decision: string | null;
      environment: string | null;
    };
  }
) {
  return {
    id: task.id,
    tenant_id: task.tenantId,
    workspace_id: task.workspaceId,
    skill_run_id: task.skillRunId,
    approval_request_id: task.approvalRequestId,
    gate_check_result_id: task.gateCheckResultId,
    trace_id: task.traceId,
    check_key: task.checkKey,
    label: task.label,
    evidence_skill_id: task.evidenceSkillId,
    target_skill_id: task.targetSkillId,
    runtime: task.runtime,
    status: task.status,
    priority: task.priority,
    attempt: task.attempt,
    claimed_by_agent_id: task.claimedByAgentId,
    lease_expires_at: task.leaseExpiresAt?.toISOString() ?? null,
    input: task.input,
    result: task.result,
    error: task.error,
    created_by: task.createdBy,
    claimed_at: task.claimedAt?.toISOString() ?? null,
    started_at: task.startedAt?.toISOString() ?? null,
    completed_at: task.completedAt?.toISOString() ?? null,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    gate_check_status: task.gateCheckResult.status,
    gate_check_evidence: task.gateCheckResult.evidence,
    approval: task.approvalRequest
      ? {
          id: task.approvalRequest.id,
          status: task.approvalRequest.status,
          approval_readiness: task.approvalRequest.approvalReadiness
        }
      : null,
    skill_run: {
      id: task.skillRun.id,
      raw_action: task.skillRun.rawAction,
      status: task.skillRun.status,
      decision: task.skillRun.decision,
      environment: task.skillRun.environment
    }
  };
}

function serializeMonitorEvent(event: AuditEvent) {
  return {
    id: event.id,
    skill_run_id: event.skillRunId,
    trace_id: event.traceId,
    event_type: event.eventType,
    actor_type: event.actorType,
    actor_id: event.actorId,
    sequence: event.sequence,
    metadata: event.metadata,
    created_at: event.createdAt.toISOString()
  };
}
