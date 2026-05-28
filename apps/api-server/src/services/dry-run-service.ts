import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { Prisma, type PrismaClient, type RiskLevel } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createOrUpdateApprovalRequest } from "./approval-service";
import { createGateCheckResults } from "./gate-check-service";
import { createId } from "./id";
import { resolvedSkillId } from "./object-utils";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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
  return prisma.$transaction(async (tx) => {
    const run = await tx.skillRun.findUnique({
      where: { id: runId },
      include: {
        agent: true,
        skill: true,
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
    if (skillId !== "run-db-migration") {
      return {
        status: 400 as const,
        body: {
          error: "Skill does not support dry-run in the MVP demo",
          skill_id: skillId
        }
      };
    }

    await tx.skillRun.update({
      where: { id: run.id },
      data: { status: "dry_run_running" }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "dry_run.started",
      actorType: "system",
      actorId: requestedBy,
      metadata: {
        skill_id: skillId
      }
    });

    const dryRunPayload = {
      summary: "Schema diff generated. 2 tables altered, 1 index added.",
      lock_impact: "medium",
      destructive_changes: false,
      artifacts: [
        {
          type: "schema_diff",
          artifact_id: "artifact_schema_diff_001"
        }
      ]
    };

    const dryRunResult = await tx.dryRunResult.upsert({
      where: { skillRunId: run.id },
      create: {
        id: createId("dry"),
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        status: "completed",
        summary: dryRunPayload.summary,
        result: dryRunPayload as Prisma.InputJsonValue,
        artifacts: dryRunPayload.artifacts as Prisma.InputJsonValue
      },
      update: {
        status: "completed",
        summary: dryRunPayload.summary,
        result: dryRunPayload as Prisma.InputJsonValue,
        artifacts: dryRunPayload.artifacts as Prisma.InputJsonValue
      }
    });

    const nextContext = {
      ...(run.context as Record<string, unknown>),
      dry_run_completed: true,
      schema_diff_generated: true,
      backup_exists: true
    };

    const fixtures = await loadDemoFixtures(configDir);
    const postDryRunPolicy = evaluatePolicy({
      rules: fixtures.policies.rules,
      role: run.agent?.role ?? "db_agent",
      skill_id: skillId,
      risk_level: run.riskLevel ?? ("critical" as RiskLevel),
      context: nextContext
    });

    const missingChecks = postDryRunPolicy.required_checks.filter(
      (check) => !checkIsSatisfiedAfterDryRun(check, nextContext)
    );

    await createGateCheckResults(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      skillId,
      requiredChecks: postDryRunPolicy.required_checks,
      context: nextContext
    });

    await tx.skillRun.update({
      where: { id: run.id },
      data: {
        context: nextContext as Prisma.InputJsonValue,
        status: postDryRunPolicy.decision === "REQUIRE_APPROVAL" ? "approval_required" : "dry_run_completed",
        decision: postDryRunPolicy.decision,
        reason: postDryRunPolicy.reason,
        policySnapshot: {
          ...(run.policySnapshot as Record<string, unknown>),
          post_dry_run_decision: postDryRunPolicy.decision,
          post_dry_run_reason: postDryRunPolicy.reason,
          required_checks: postDryRunPolicy.required_checks,
          approvers: postDryRunPolicy.approvers,
          missing_checks: missingChecks
        } as Prisma.InputJsonValue
      }
    });

    await emitAuditEvent(tx, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      traceId: run.traceId,
      eventType: "dry_run.completed",
      actorType: "system",
      actorId: requestedBy,
      metadata: {
        dry_run_result_id: dryRunResult.id,
        result: dryRunPayload,
        post_dry_run_decision: postDryRunPolicy.decision,
        missing_checks: missingChecks
      }
    });

    if (postDryRunPolicy.decision === "REQUIRE_APPROVAL") {
      const approval = await createOrUpdateApprovalRequest(tx, {
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        traceId: run.traceId,
        riskLevel: run.riskLevel ?? ("critical" as RiskLevel),
        missingChecks,
        requiredApprovers: postDryRunPolicy.approvers,
        evidence: {
          dry_run_result_id: dryRunResult.id,
          dry_run: dryRunPayload,
          policy_reason: postDryRunPolicy.reason,
          required_checks: postDryRunPolicy.required_checks
        }
      });

      await emitAuditEvent(tx, {
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        traceId: run.traceId,
        eventType: "approval.requested",
        actorType: "system",
        actorId: requestedBy,
        metadata: {
          approval_id: approval.id,
          source: "post_dry_run_policy",
          missing_checks: missingChecks
        }
      });
    }

    return {
      status: 200 as const,
      body: {
        dry_run_result: {
          id: dryRunResult.id,
          status: dryRunResult.status,
          summary: dryRunResult.summary,
          result: dryRunResult.result,
          artifacts: dryRunResult.artifacts
        },
        decision: postDryRunPolicy.decision,
        missing_checks: missingChecks
      }
    };
  });
}

function checkIsSatisfiedAfterDryRun(check: string, context: Record<string, unknown>): boolean {
  if (check === "dry_run_completed") return context.dry_run_completed === true;
  if (check === "schema_diff_generated") return context.schema_diff_generated === true;
  if (check === "backup_exists") return context.backup_exists === true;
  return false;
}
