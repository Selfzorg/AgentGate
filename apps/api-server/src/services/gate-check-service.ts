import { Prisma, type PrismaClient } from "@prisma/client";
import { createId } from "./id";

export type GateCheckInput = {
  tenantId: string;
  workspaceId: string;
  skillRunId: string;
  skillId: string;
  requiredChecks: string[];
  context: Record<string, unknown>;
};

type GateCheckStatus = "passed" | "failed" | "missing" | "unknown";

const labels: Record<string, string> = {
  ci_passed: "CI passed",
  tests_passed: "Tests passed",
  rollback_plan_exists: "Rollback plan exists",
  staging_deploy_successful: "Staging deploy successful",
  dry_run_completed: "Dry-run completed",
  schema_diff_generated: "Schema diff generated",
  backup_exists: "Backup exists",
  required_reviews_passed: "Required reviews passed",
  branch_protection_satisfied: "Branch protection satisfied"
};

export async function createGateCheckResults(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: GateCheckInput
) {
  await prisma.gateCheckResult.deleteMany({
    where: {
      skillRunId: input.skillRunId
    }
  });

  const results = input.requiredChecks.map((checkKey) => {
    const status = statusForCheck(checkKey, input.context);
    return {
      id: createId("gcr"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      skillRunId: input.skillRunId,
      checkKey,
      label: labels[checkKey] ?? checkKey,
      status,
      evidence: evidenceForCheck(checkKey, status, input.context, input.skillId) as Prisma.InputJsonValue
    };
  });

  if (results.length > 0) {
    await prisma.gateCheckResult.createMany({ data: results });
  }

  return results;
}

export async function getMissingChecks(
  prisma: PrismaClient | Prisma.TransactionClient,
  skillRunId: string
): Promise<string[]> {
  const gateChecks = await prisma.gateCheckResult.findMany({
    where: {
      skillRunId
    },
    orderBy: {
      checkKey: "asc"
    }
  });

  return gateChecks
    .filter((check) => check.status !== "passed")
    .map((check) => check.checkKey);
}

function statusForCheck(checkKey: string, context: Record<string, unknown>): GateCheckStatus {
  if (checkKey === "ci_passed") return statusFromTriState(context.ci_status, "passed");
  if (checkKey === "tests_passed") return statusFromTriState(context.tests_status, "passed");
  if (checkKey === "rollback_plan_exists") return statusFromTriState(context.rollback_plan, "exists");
  if (checkKey === "staging_deploy_successful") return statusFromTriState(context.staging_deploy, "success");
  if (checkKey === "dry_run_completed") return context.dry_run_completed === true ? "passed" : "missing";
  if (checkKey === "schema_diff_generated") return context.schema_diff_generated === true ? "passed" : "missing";
  if (checkKey === "backup_exists") return context.backup_exists === true ? "passed" : "missing";
  if (checkKey === "required_reviews_passed") {
    return context.required_reviews_passed === true ? "passed" : "missing";
  }
  if (checkKey === "branch_protection_satisfied") {
    return context.branch_protection_satisfied === true ? "passed" : "missing";
  }
  return "unknown";
}

function statusFromTriState(value: unknown, passingValue: string): GateCheckStatus {
  if (value === passingValue) return "passed";
  if (value === undefined || value === "unknown") return "missing";
  return "failed";
}

function evidenceForCheck(
  checkKey: string,
  status: GateCheckStatus,
  context: Record<string, unknown>,
  skillId: string
) {
  return {
    source: "demo_context",
    skill_id: skillId,
    context_key: checkKey,
    status,
    observed_context: context
  };
}
