import { Prisma, type ApprovalStatus, type PrismaClient, type RiskLevel } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { getMissingChecks } from "./gate-check-service";
import { createId } from "./id";

export type ApprovalPacketInput = {
  tenantId: string;
  workspaceId: string;
  skillRunId: string;
  traceId: string;
  riskLevel: RiskLevel;
  missingChecks: string[];
  requiredApprovers: string[];
  evidence: Record<string, unknown>;
  approvalReadiness?: string | undefined;
};

export type ApprovalActionInput = {
  approvalId: string;
  actorId?: string | undefined;
  comment?: string | undefined;
};

export type ApprovalQueueOptions = {
  limit?: number | undefined;
  offset?: number | undefined;
  status?: ApprovalStatus | undefined;
  q?: string | undefined;
};

const DEFAULT_APPROVAL_QUEUE_LIMIT = 25;
const MAX_APPROVAL_QUEUE_LIMIT = 100;

export async function createOrUpdateApprovalRequest(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: ApprovalPacketInput
) {
  const readiness = input.approvalReadiness ?? (input.missingChecks.length === 0 ? "ready" : "blocked");
  const data = {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    skillRunId: input.skillRunId,
    status: "pending" as ApprovalStatus,
    riskLevel: input.riskLevel,
    approvalReadiness: readiness,
    missingChecks: input.missingChecks as Prisma.InputJsonValue,
    requiredApprovers: input.requiredApprovers as Prisma.InputJsonValue,
    evidence: input.evidence as Prisma.InputJsonValue,
    requestedBy: "system"
  };

  return prisma.approvalRequest.upsert({
    where: { skillRunId: input.skillRunId },
    create: {
      id: createId("appr"),
      ...data
    },
    update: data
  });
}

export async function getApprovalQueue(prisma: PrismaClient, options: ApprovalQueueOptions = {}) {
  const limit = clampNumber(options.limit, DEFAULT_APPROVAL_QUEUE_LIMIT, 1, MAX_APPROVAL_QUEUE_LIMIT);
  const offset = clampNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const search = options.q?.trim();
  const and: Prisma.ApprovalRequestWhereInput[] = [];
  if (options.status) and.push({ status: options.status });
  if (search) {
    and.push({
      OR: [
        { id: { contains: search, mode: "insensitive" } },
        {
          skillRun: {
            is: {
              OR: [
                { id: { contains: search, mode: "insensitive" } },
                { traceId: { contains: search, mode: "insensitive" } },
                { rawAction: { contains: search, mode: "insensitive" } }
              ]
            }
          }
        }
      ]
    });
  }
  const where: Prisma.ApprovalRequestWhereInput = and.length > 0 ? { AND: and } : {};

  const [total, approvals] = await prisma.$transaction([
    prisma.approvalRequest.count({ where }),
    prisma.approvalRequest.findMany({
      where,
      include: {
        skillRun: {
          include: {
            agent: {
              select: {
                externalAgentId: true,
                role: true,
                displayName: true
              }
            },
            skill: {
              select: {
                skillId: true,
                name: true
              }
            },
            gateCheckResults: {
              select: {
                id: true,
                checkKey: true,
                label: true,
                status: true,
                evidence: true
              },
              orderBy: { checkKey: "asc" }
            },
            evidenceTasks: {
              select: {
                id: true,
                gateCheckResultId: true,
                status: true,
                runtime: true,
                attempt: true,
                claimedByAgentId: true,
                leaseExpiresAt: true,
                createdAt: true,
                updatedAt: true
              },
              orderBy: [{ checkKey: "asc" }, { attempt: "desc" }],
              take: 20
            },
            dryRunResult: {
              select: {
                id: true,
                status: true,
                summary: true,
                createdAt: true
              }
            }
          }
        }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: limit,
      skip: offset
    })
  ]);

  return {
    approvals: approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      risk_level: approval.riskLevel,
      approval_readiness: approval.approvalReadiness,
      missing_checks: approval.missingChecks,
      required_approvers: approval.requiredApprovers,
      evidence: approval.evidence,
      comment: approval.comment,
      created_at: approval.createdAt.toISOString(),
      updated_at: approval.updatedAt.toISOString(),
      skill_run: {
        id: approval.skillRun.id,
        trace_id: approval.skillRun.traceId,
        raw_action: approval.skillRun.rawAction,
        source: approval.skillRun.source,
        environment: approval.skillRun.environment,
        decision: approval.skillRun.decision,
        status: approval.skillRun.status,
        reason: approval.skillRun.reason,
        risk_score: approval.skillRun.riskScore,
        agent: approval.skillRun.agent
          ? {
              id: approval.skillRun.agent.externalAgentId,
              role: approval.skillRun.agent.role,
              display_name: approval.skillRun.agent.displayName
            }
          : null,
        skill: approval.skillRun.skill
          ? {
              id: approval.skillRun.skill.skillId,
              name: approval.skillRun.skill.name
            }
          : null,
        gate_checks: approval.skillRun.gateCheckResults.map((check) => ({
          id: check.id,
          check_key: check.checkKey,
          label: check.label,
          status: check.status,
          evidence: check.evidence,
          evidence_tasks: approval.skillRun.evidenceTasks
            .filter((task) => task.gateCheckResultId === check.id)
            .map((task) => ({
              id: task.id,
              status: task.status,
              runtime: task.runtime,
              attempt: task.attempt,
              claimed_by_agent_id: task.claimedByAgentId,
              lease_expires_at: task.leaseExpiresAt?.toISOString() ?? null,
              created_at: task.createdAt.toISOString(),
              updated_at: task.updatedAt.toISOString()
            }))
        })),
        dry_run_result: approval.skillRun.dryRunResult
          ? {
              id: approval.skillRun.dryRunResult.id,
              status: approval.skillRun.dryRunResult.status,
              summary: approval.skillRun.dryRunResult.summary,
              created_at: approval.skillRun.dryRunResult.createdAt.toISOString()
            }
          : null
      }
    })),
    pagination: {
      limit,
      offset,
      total,
      has_more: offset + approvals.length < total
    }
  };
}

export async function approveRequest(
  prisma: PrismaClient,
  input: ApprovalActionInput
) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.findUnique({
      where: { id: input.approvalId },
      include: {
        skillRun: true
      }
    });

    if (!approval) {
      return { status: 404 as const, body: { error: "Approval request not found" } };
    }

    if (approval.status !== "pending") {
      return { status: 409 as const, body: { error: "Approval request is not pending" } };
    }

    const missingChecks = await getMissingChecks(tx, approval.skillRunId);
    if (missingChecks.length > 0) {
      return {
        status: 400 as const,
        body: {
          error: "Approval is blocked by missing checks",
          missing_checks: missingChecks
        }
      };
    }

    if (approval.riskLevel === "critical" && !input.comment?.trim()) {
      return {
        status: 400 as const,
        body: {
          error: "Critical approvals require a non-empty comment"
        }
      };
    }

    const updateData: Prisma.ApprovalRequestUncheckedUpdateInput = {
      status: "approved",
      approvedAt: new Date()
    };
    if (input.actorId) updateData.approvedByUserId = input.actorId;
    if (input.comment) updateData.comment = input.comment;

    const updated = await tx.approvalRequest.update({
      where: { id: approval.id },
      data: updateData
    });

    await tx.skillRun.update({
      where: { id: approval.skillRunId },
      data: { status: "approved" }
    });

    await emitAuditEvent(tx, {
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      skillRunId: approval.skillRunId,
      traceId: approval.skillRun.traceId,
      eventType: "approval.granted",
      actorType: "user",
      actorId: input.actorId ?? "user_service_owner",
      metadata: {
        approval_id: approval.id,
        comment: input.comment ?? null
      }
    });

    return { status: 200 as const, body: { approval: serializeApproval(updated) } };
  });
}

export async function denyRequest(prisma: PrismaClient, input: ApprovalActionInput) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.findUnique({
      where: { id: input.approvalId },
      include: {
        skillRun: true
      }
    });

    if (!approval) {
      return { status: 404 as const, body: { error: "Approval request not found" } };
    }

    if (approval.status !== "pending") {
      return { status: 409 as const, body: { error: "Approval request is not pending" } };
    }

    const updateData: Prisma.ApprovalRequestUncheckedUpdateInput = {
      status: "denied",
      deniedAt: new Date()
    };
    if (input.actorId) updateData.deniedByUserId = input.actorId;
    if (input.comment) updateData.comment = input.comment;

    const updated = await tx.approvalRequest.update({
      where: { id: approval.id },
      data: updateData
    });

    await tx.skillRun.update({
      where: { id: approval.skillRunId },
      data: { status: "denied" }
    });

    await emitAuditEvent(tx, {
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      skillRunId: approval.skillRunId,
      traceId: approval.skillRun.traceId,
      eventType: "approval.denied",
      actorType: "user",
      actorId: input.actorId ?? "user_service_owner",
      metadata: {
        approval_id: approval.id,
        comment: input.comment ?? null
      }
    });

    return { status: 200 as const, body: { approval: serializeApproval(updated) } };
  });
}

function serializeApproval(approval: Awaited<ReturnType<PrismaClient["approvalRequest"]["update"]>>) {
  return {
    id: approval.id,
    status: approval.status,
    approval_readiness: approval.approvalReadiness,
    missing_checks: approval.missingChecks,
    comment: approval.comment,
    updated_at: approval.updatedAt.toISOString()
  };
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
