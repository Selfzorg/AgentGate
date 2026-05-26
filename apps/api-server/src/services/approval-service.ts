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
};

export type ApprovalActionInput = {
  approvalId: string;
  actorId?: string | undefined;
  comment?: string | undefined;
};

export async function createOrUpdateApprovalRequest(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: ApprovalPacketInput
) {
  const readiness = input.missingChecks.length === 0 ? "ready" : "blocked";
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

export async function getApprovalQueue(prisma: PrismaClient) {
  const approvals = await prisma.approvalRequest.findMany({
    include: {
      skillRun: {
        include: {
          agent: true,
          skill: true,
          gateCheckResults: {
            orderBy: { checkKey: "asc" }
          },
          dryRunResult: true
        }
      }
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }]
  });

  return approvals.map((approval) => ({
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
        evidence: check.evidence
      })),
      dry_run_result: approval.skillRun.dryRunResult
        ? {
            id: approval.skillRun.dryRunResult.id,
            status: approval.skillRun.dryRunResult.status,
            summary: approval.skillRun.dryRunResult.summary,
            result: approval.skillRun.dryRunResult.result,
            artifacts: approval.skillRun.dryRunResult.artifacts,
            created_at: approval.skillRun.dryRunResult.createdAt.toISOString()
          }
        : null
    }
  }));
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
