import type { PrismaClient } from "@prisma/client";
import { recordFrom, stringFrom } from "./object-utils";

export const evidenceRuntimeIds = [
  "codex_cli",
  "claude_cli",
  "claude_code_mcp",
  "codex_mcp",
  "internal_simulated_agent",
  "native_connector",
  "local_deterministic"
] as const;

export type EvidenceRuntimeId = (typeof evidenceRuntimeIds)[number];
export type EvidenceSkillType = "evidence" | "execution";
export type EvidenceSideEffectLevel = "read_only" | "simulated" | "mutating";
export type EvidenceSkillRegistrySource = "database" | "built_in_fallback";

export type EvidenceSkillDefinition = {
  checkKey: string;
  skillId: string;
  name: string;
  version: string;
  connectorId: string | null;
  skillType: EvidenceSkillType;
  sideEffectLevel: EvidenceSideEffectLevel;
  allowedRuntimes: EvidenceRuntimeId[];
  preferredRuntimes: EvidenceRuntimeId[];
  registrySource: EvidenceSkillRegistrySource;
};

const defaultAllowedRuntimes: EvidenceRuntimeId[] = [
  "codex_cli",
  "claude_cli",
  "claude_code_mcp",
  "codex_mcp",
  "local_deterministic",
  "native_connector"
];
const defaultPreferredRuntimes: EvidenceRuntimeId[] = ["codex_cli", "claude_code_mcp", "local_deterministic", "native_connector"];

const builtInEvidenceSkills: Record<string, Omit<EvidenceSkillDefinition, "registrySource">> = {
  ci_passed: builtIn("ci_passed", "verify-ci-status", "Verify CI Status", "connector_github_demo"),
  tests_passed: builtIn("tests_passed", "verify-tests-passed", "Verify Tests Passed", "connector_github_demo"),
  rollback_plan_exists: builtIn("rollback_plan_exists", "verify-rollback-plan", "Verify Rollback Plan", "connector_deployment_demo"),
  staging_deploy_successful: builtIn(
    "staging_deploy_successful",
    "verify-staging-deploy",
    "Verify Staging Deploy",
    "connector_deployment_demo"
  ),
  required_reviews_passed: builtIn(
    "required_reviews_passed",
    "verify-required-reviews",
    "Verify Required Reviews",
    "connector_github_demo"
  ),
  branch_protection_satisfied: builtIn(
    "branch_protection_satisfied",
    "verify-branch-protection",
    "Verify Branch Protection",
    "connector_github_demo"
  ),
  dry_run_completed: builtIn("dry_run_completed", "verify-dry-run-completed", "Verify Dry-Run Completed", "connector_db_demo"),
  schema_diff_generated: builtIn("schema_diff_generated", "verify-schema-diff", "Verify Schema Diff", "connector_db_demo"),
  backup_exists: builtIn("backup_exists", "verify-database-backup", "Verify Database Backup", "connector_db_demo")
};

export async function resolveEvidenceSkill({
  prisma,
  tenantId,
  workspaceId,
  checkKey
}: {
  prisma: PrismaClient;
  tenantId: string;
  workspaceId: string;
  checkKey: string;
}): Promise<EvidenceSkillDefinition> {
  const skills = await prisma.skill.findMany({
    where: {
      tenantId,
      workspaceId,
      status: "active"
    },
    include: {
      versions: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  for (const skill of skills) {
    for (const version of skill.versions) {
      const config = recordFrom(version.config);
      if (stringFrom(config.check_key) !== checkKey) continue;

      const skillType = skillTypeFrom(config.skill_type);
      const sideEffectLevel = sideEffectLevelFrom(config.side_effect_level);

      return {
        checkKey,
        skillId: skill.skillId,
        name: skill.name,
        version: version.version,
        connectorId: version.connectorId,
        skillType,
        sideEffectLevel,
        allowedRuntimes: runtimeListFrom(config.allowed_runtimes, defaultAllowedRuntimes),
        preferredRuntimes: runtimeListFrom(config.preferred_runtimes, defaultPreferredRuntimes),
        registrySource: "database"
      };
    }
  }

  const fallback = builtInEvidenceSkills[checkKey] ?? builtIn(checkKey, `verify-${checkKey}`, labelForCheck(checkKey), null);
  return materializeFallbackEvidenceSkill(prisma, {
    tenantId,
    workspaceId,
    fallback: {
      ...fallback,
      registrySource: "built_in_fallback"
    }
  });
}

async function materializeFallbackEvidenceSkill(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    fallback: EvidenceSkillDefinition;
  }
): Promise<EvidenceSkillDefinition> {
  try {
    const connector = input.fallback.connectorId
      ? await prisma.connector.findUnique({
          where: { id: input.fallback.connectorId },
          select: { id: true }
        })
      : null;
    const skill = await prisma.skill.upsert({
      where: {
        tenantId_workspaceId_skillId: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          skillId: input.fallback.skillId
        }
      },
      create: {
        id: `skill_${input.fallback.skillId.replaceAll("-", "_")}`,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        skillId: input.fallback.skillId,
        name: input.fallback.name,
        category: "evidence",
        defaultRiskLevel: "low",
        description: `${input.fallback.name} evidence skill`
      },
      update: {
        category: "evidence",
        description: `${input.fallback.name} evidence skill`
      }
    });
    const version = input.fallback.version === "0.0.0" ? "1.0.0" : input.fallback.version;

    await prisma.skillVersion.upsert({
      where: {
        skillRecordId_version: {
          skillRecordId: skill.id,
          version
        }
      },
      create: {
        id: `${skill.id}_v${version.replaceAll(".", "_")}`,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        skillRecordId: skill.id,
        connectorId: connector?.id ?? null,
        version,
        config: skillConfig(input.fallback),
        execution: {
          live_requires_execution_token: false
        }
      },
      update: {
        connectorId: connector?.id ?? null,
        config: skillConfig(input.fallback),
        execution: {
          live_requires_execution_token: false
        }
      }
    });

    return {
      ...input.fallback,
      version,
      connectorId: connector?.id ?? null,
      registrySource: "database"
    };
  } catch {
    return input.fallback;
  }
}

function skillConfig(skill: EvidenceSkillDefinition) {
  return {
    fixture: true,
    supports_dry_run: false,
    skill_type: skill.skillType,
    side_effect_level: skill.sideEffectLevel,
    check_key: skill.checkKey,
    allowed_runtimes: skill.allowedRuntimes,
    preferred_runtimes: skill.preferredRuntimes
  };
}

export function isEvidenceRuntimeId(value: unknown): value is EvidenceRuntimeId {
  return normalizeEvidenceRuntimeId(value) !== null;
}

export function normalizeEvidenceRuntimeId(value: unknown): EvidenceRuntimeId | null {
  if (value === "agent") return "claude_code_mcp";
  return typeof value === "string" && evidenceRuntimeIds.includes(value as EvidenceRuntimeId) ? (value as EvidenceRuntimeId) : null;
}

export function labelForCheck(checkKey: string): string {
  return checkKey
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function builtIn(
  checkKey: string,
  skillId: string,
  name: string,
  connectorId: string | null
): Omit<EvidenceSkillDefinition, "registrySource"> {
  return {
    checkKey,
    skillId,
    name,
    version: "0.0.0",
    connectorId,
    skillType: "evidence",
    sideEffectLevel: "read_only",
    allowedRuntimes: defaultAllowedRuntimes,
    preferredRuntimes: defaultPreferredRuntimes
  };
}

function runtimeListFrom(value: unknown, fallback: EvidenceRuntimeId[]): EvidenceRuntimeId[] {
  if (!Array.isArray(value)) return fallback;

  const runtimes = value.flatMap((entry) => {
    const runtime = normalizeEvidenceRuntimeId(entry);
    return runtime ? [runtime] : [];
  });
  return runtimes.length > 0 ? [...new Set(runtimes)] : fallback;
}

function skillTypeFrom(value: unknown): EvidenceSkillType {
  return value === "evidence" ? "evidence" : "execution";
}

function sideEffectLevelFrom(value: unknown): EvidenceSideEffectLevel {
  if (value === "read_only" || value === "simulated" || value === "mutating") return value;
  return "mutating";
}
