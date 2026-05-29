import { Prisma, type EvidenceTask, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { findReusableEvidenceArtifact } from "./evidence-artifact-cache-service";
import { subagentForCheck } from "./evidence-runtimes";
import { evidenceSkillSnapshot, evidenceTaskCreateData, preferredRuntime } from "./evidence-task-builders";
import { nextTaskAttempt, updateApprovalReadiness } from "./evidence-task-completion";
import { serializeApproval, serializeEvidenceTask, serializeGateCheck } from "./evidence-task-presenters";
import { ACTIVE_EVIDENCE_TASK_STATUSES } from "./evidence-task-types";
import { resolveEvidenceSkill } from "./evidence-skill-registry";
import { recordFrom } from "./object-utils";

export type { EvidenceTaskResultInput } from "./evidence-task-types";
export {
  claimEvidenceTask,
  clearActiveEvidenceQueue,
  completeEvidenceTask,
  failEvidenceTask,
  getEvidenceTask,
  heartbeatEvidenceTask,
  listPendingEvidenceTasks,
  prioritizeEvidenceTask,
  processEvidenceTasksOnce
} from "./evidence-task-queue-service";

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
        selectedRuntime: preferredRuntime(evidenceSkill, context, check.checkKey),
        cachedEvidence: await findReusableEvidenceArtifact(prisma, {
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          checkKey: check.checkKey,
          context: run.context,
          environment: run.environment
        })
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
      if (plan.cachedEvidence) {
        await tx.gateCheckResult.update({
          where: { id: plan.check.id },
          data: {
            status: plan.cachedEvidence.status,
            evidence: {
              source: "evidence_cache",
              status: plan.cachedEvidence.status,
              reason: plan.cachedEvidence.reason,
              cached_artifact_id: plan.cachedEvidence.id,
              collected_at: plan.cachedEvidence.collected_at,
              expires_at: plan.cachedEvidence.expires_at,
              confidence: plan.cachedEvidence.confidence,
              target_identity: plan.cachedEvidence.target_identity,
              details: plan.cachedEvidence.evidence,
              evidence_skill: evidenceSkillSnapshot(plan.evidenceSkill)
            } as Prisma.InputJsonValue
          }
        });

        await emitAuditEvent(tx, {
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          skillRunId: run.id,
          traceId: run.traceId,
          eventType: "evidence.cache.reused",
          actorType: "system",
          actorId: requestedBy,
          metadata: {
            check_key: plan.check.checkKey,
            cached_artifact_id: plan.cachedEvidence.id,
            target_identity: plan.cachedEvidence.target_identity,
            status: plan.cachedEvidence.status
          }
        });
        continue;
      }

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

    const readiness = await updateApprovalReadiness(tx, run.id);
    const approval = readiness.approval ?? (await tx.approvalRequest.findUniqueOrThrow({ where: { id: run.approvalRequest!.id } }));

    return {
      approval,
      gateChecks: readiness.gateChecks,
      tasks,
      missingChecks: readiness.missingChecks
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
