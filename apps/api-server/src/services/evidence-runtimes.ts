import type { GateCheckStatus } from "@prisma/client";
import {
  type EvidenceRuntimeId,
  type EvidenceSkillDefinition,
  labelForCheck,
  normalizeEvidenceRuntimeId
} from "./evidence-skill-registry";

export type EvidenceCheckStatus = Exclude<GateCheckStatus, "pending" | "running" | "unknown">;

export type EvidenceSubagent = {
  id: string;
  role: string;
  description: string;
};

export type EvidenceRuntimeFallback = {
  runtime: EvidenceRuntimeId;
  reason: string;
};

export type EvidenceRuntimeExecutionInput = {
  checkKey: string;
  label: string;
  attempt: number;
  context: Record<string, unknown>;
  rawAction: string;
  targetSkillId: string;
  requestedBy: string;
  evidenceSkill: EvidenceSkillDefinition;
};

export type EvidenceRuntimeExecutionResult = {
  status: EvidenceCheckStatus;
  reason: string;
  subagent: EvidenceSubagent;
  selectedRuntime: EvidenceRuntimeId;
  runtimeFallbacks: EvidenceRuntimeFallback[];
  evidence: Record<string, unknown>;
};

type EvidenceDirective = {
  status: EvidenceCheckStatus;
  reason?: string | undefined;
  once?: boolean | undefined;
};

type EvidenceRuntimeAdapter = {
  id: EvidenceRuntimeId;
  unavailableReason: (input: EvidenceRuntimeExecutionInput) => string | null;
  execute: (input: EvidenceRuntimeExecutionInput) => Promise<Omit<EvidenceRuntimeExecutionResult, "selectedRuntime" | "runtimeFallbacks">>;
};

const passByDefaultChecks = new Set([
  "ci_passed",
  "tests_passed",
  "rollback_plan_exists",
  "staging_deploy_successful"
]);

const runtimeAdapters: Record<EvidenceRuntimeId, EvidenceRuntimeAdapter> = {
  codex_cli: {
    id: "codex_cli",
    unavailableReason: () => "codex_cli evidence runtime must claim an evidence task asynchronously",
    execute: async (input) => executeReadOnlyEvidenceSkill(input, "codex_cli")
  },
  claude_cli: {
    id: "claude_cli",
    unavailableReason: () => "claude_cli evidence runtime must claim an evidence task asynchronously",
    execute: async (input) => executeReadOnlyEvidenceSkill(input, "claude_cli")
  },
  claude_code_mcp: {
    id: "claude_code_mcp",
    unavailableReason: () => "claude_code_mcp evidence runtime must claim an evidence task asynchronously",
    execute: async (input) => executeReadOnlyEvidenceSkill(input, "claude_code_mcp")
  },
  codex_mcp: {
    id: "codex_mcp",
    unavailableReason: () => "codex_mcp evidence runtime must claim an evidence task asynchronously",
    execute: async (input) => executeReadOnlyEvidenceSkill(input, "codex_mcp")
  },
  internal_simulated_agent: {
    id: "internal_simulated_agent",
    unavailableReason: () =>
      process.env.AGENTGATE_EVIDENCE_INTERNAL_AGENT === "true" ? null : "internal simulated agent runtime disabled",
    execute: async (input) => executeReadOnlyEvidenceSkill(input, "internal_simulated_agent")
  },
  native_connector: {
    id: "native_connector",
    unavailableReason: () =>
      process.env.AGENTGATE_EVIDENCE_NATIVE_CONNECTORS === "simulated" ||
      process.env.AGENTGATE_EVIDENCE_NATIVE_CONNECTORS === "true"
        ? null
        : "native connector evidence runtime not configured",
    execute: async (input) => executeReadOnlyEvidenceSkill(input, "native_connector")
  },
  local_deterministic: {
    id: "local_deterministic",
    unavailableReason: () => null,
    execute: async (input) => executeReadOnlyEvidenceSkill(input, "local_deterministic")
  }
};

export async function executeEvidenceRuntime(input: EvidenceRuntimeExecutionInput): Promise<EvidenceRuntimeExecutionResult> {
  const subagent = subagentForCheck(input.checkKey);
  const safetyError = evidenceSkillSafetyError(input.evidenceSkill);
  const runtimePlan = runtimePlanFor(input);

  if (safetyError) {
    return {
      status: "failed",
      reason: safetyError,
      subagent,
      selectedRuntime: runtimePlan[0] ?? "local_deterministic",
      runtimeFallbacks: [],
      evidence: baseEvidence(input, {
        subagent,
        selectedRuntime: runtimePlan[0] ?? "local_deterministic",
        runtimeMode: "safety_refused",
        status: "failed",
        reason: safetyError,
        runtimeFallbacks: []
      })
    };
  }

  const runtimeFallbacks: EvidenceRuntimeFallback[] = [];
  for (const runtimeId of runtimePlan) {
    const adapter = runtimeAdapters[runtimeId];
    const unavailableReason = adapter.unavailableReason(input);
    if (unavailableReason) {
      runtimeFallbacks.push({ runtime: runtimeId, reason: unavailableReason });
      continue;
    }

    const result = await adapter.execute(input);
    return {
      ...result,
      selectedRuntime: adapter.id,
      runtimeFallbacks,
      evidence: {
        ...result.evidence,
        selected_runtime: adapter.id,
        runtime_fallbacks: runtimeFallbacks
      }
    };
  }

  const reason = "No enabled evidence runtime could execute this check.";
  return {
    status: "failed",
    reason,
    subagent,
    selectedRuntime: "local_deterministic",
    runtimeFallbacks,
    evidence: baseEvidence(input, {
      subagent,
      selectedRuntime: "local_deterministic",
      runtimeMode: "no_runtime_available",
      status: "failed",
      reason,
      runtimeFallbacks
    })
  };
}

export function subagentForCheck(checkKey: string): EvidenceSubagent {
  if (checkKey === "ci_passed") {
    return {
      id: "subagent_ci_evidence",
      role: "CI evidence subagent",
      description: "Finds the CI status skill and verifies the latest pipeline result."
    };
  }
  if (checkKey === "tests_passed") {
    return {
      id: "subagent_test_evidence",
      role: "Test evidence subagent",
      description: "Finds the test verification skill and verifies the latest test outcome."
    };
  }
  if (checkKey === "rollback_plan_exists") {
    return {
      id: "subagent_rollback_evidence",
      role: "Rollback evidence subagent",
      description: "Finds rollback-plan evidence for the target service."
    };
  }
  if (checkKey === "staging_deploy_successful") {
    return {
      id: "subagent_staging_evidence",
      role: "Staging evidence subagent",
      description: "Finds the staging deployment verification skill."
    };
  }
  if (checkKey === "required_reviews_passed" || checkKey === "branch_protection_satisfied") {
    return {
      id: "subagent_github_evidence",
      role: "GitHub evidence subagent",
      description: "Finds review and branch protection evidence."
    };
  }
  if (checkKey.startsWith("dry_run") || checkKey.includes("schema") || checkKey.includes("backup")) {
    return {
      id: "subagent_database_evidence",
      role: "Database evidence subagent",
      description: "Finds dry-run, schema diff, and backup evidence."
    };
  }
  return {
    id: "subagent_policy_evidence",
    role: "Policy evidence subagent",
    description: "Finds evidence for a policy-required check."
  };
}

function runtimePlanFor(input: EvidenceRuntimeExecutionInput): EvidenceRuntimeId[] {
  const overrides = recordFrom(input.context.evidence_runtime_overrides);
  const overridePlan = runtimeListFrom(overrides[input.checkKey]);
  const preferredPlan = overridePlan.length > 0 ? overridePlan : input.evidenceSkill.preferredRuntimes;
  const allowed = new Set(input.evidenceSkill.allowedRuntimes);
  const plan = preferredPlan.filter((runtime) => allowed.has(runtime));

  for (const runtime of input.evidenceSkill.allowedRuntimes) {
    if (!plan.includes(runtime)) plan.push(runtime);
  }

  return plan.length > 0 ? plan : ["local_deterministic"];
}

function evidenceSkillSafetyError(skill: EvidenceSkillDefinition): string | null {
  if (skill.skillType !== "evidence") {
    return `Evidence runtime refused to execute ${skill.skillId} because it is not an evidence skill.`;
  }

  if (skill.sideEffectLevel !== "read_only") {
    return `Evidence runtime refused to execute ${skill.skillId} because it is not read-only.`;
  }

  return null;
}

async function executeReadOnlyEvidenceSkill(
  input: EvidenceRuntimeExecutionInput,
  runtime: EvidenceRuntimeId
): Promise<Omit<EvidenceRuntimeExecutionResult, "selectedRuntime" | "runtimeFallbacks">> {
  const subagent = subagentForCheck(input.checkKey);
  const directive = directiveForCheck(input.context, input.checkKey, input.attempt);
  const status = directive.status;
  const reason = directive.reason ?? defaultReason(input.label, status, subagent.role);

  return {
    status,
    reason,
    subagent,
    evidence: baseEvidence(input, {
      subagent,
      selectedRuntime: runtime,
      runtimeMode: runtimeModeFor(runtime),
      status,
      reason,
      runtimeFallbacks: []
    })
  };
}

function baseEvidence(
  input: EvidenceRuntimeExecutionInput,
  runtime: {
    subagent: EvidenceSubagent;
    selectedRuntime: EvidenceRuntimeId;
    runtimeMode: string;
    status: EvidenceCheckStatus;
    reason: string;
    runtimeFallbacks: EvidenceRuntimeFallback[];
  }
) {
  return {
    source: "evidence_subagent",
    mode: runtime.runtimeMode,
    status: runtime.status,
    reason: runtime.reason,
    attempt: input.attempt,
    subagent: runtime.subagent,
    selected_runtime: runtime.selectedRuntime,
    runtime_fallbacks: runtime.runtimeFallbacks,
    evidence_skill: {
      skill_id: input.evidenceSkill.skillId,
      name: input.evidenceSkill.name,
      version: input.evidenceSkill.version,
      check_key: input.evidenceSkill.checkKey,
      skill_type: input.evidenceSkill.skillType,
      side_effect_level: input.evidenceSkill.sideEffectLevel,
      registry_source: input.evidenceSkill.registrySource
    },
    evidence_skill_id: input.evidenceSkill.skillId,
    target_skill_id: input.targetSkillId,
    raw_action: input.rawAction,
    observed_context: contextSummary(input.context),
    collected_at: new Date().toISOString(),
    requested_by: input.requestedBy,
    agent_execution:
      runtime.selectedRuntime !== "local_deterministic" && runtime.selectedRuntime !== "native_connector"
        ? {
            execution_mode: "read_only_evidence_skill",
            instruction: `Verify ${input.label} for the requested action.`,
            skill_registry_lookup: "matched",
            executed_skill_id: input.evidenceSkill.skillId
          }
        : null
  };
}

function directiveForCheck(context: Record<string, unknown>, checkKey: string, attempt: number): EvidenceDirective {
  const directive = readDirective(context, checkKey);
  if (directive) {
    if (directive.once && attempt > 1) {
      return {
        status: "passed",
        reason: `${labelForCheck(checkKey)} passed after evidence retry.`
      };
    }
    return {
      status: directive.status,
      reason: directive.reason,
      once: directive.once
    };
  }

  const contextStatus = directiveFromObservedContext(context, checkKey);
  if (contextStatus) return contextStatus;

  if (passByDefaultChecks.has(checkKey)) {
    return {
      status: "passed",
      reason: `${labelForCheck(checkKey)} verified by demo evidence skill.`
    };
  }

  return {
    status: "missing",
    reason: `No evidence collector is registered for ${checkKey}.`
  };
}

function directiveFromObservedContext(context: Record<string, unknown>, checkKey: string): EvidenceDirective | null {
  if (checkKey === "ci_passed") return triStateDirective(context.ci_status, "passed", "CI status passed.", "CI status did not pass.");
  if (checkKey === "tests_passed") return triStateDirective(context.tests_status, "passed", "Tests passed.", "Tests did not pass.");
  if (checkKey === "rollback_plan_exists") {
    return triStateDirective(context.rollback_plan, "exists", "Rollback plan exists.", "Rollback plan is missing.");
  }
  if (checkKey === "staging_deploy_successful") {
    return triStateDirective(context.staging_deploy, "success", "Staging deploy succeeded.", "Staging deploy has not succeeded.");
  }
  if (checkKey === "dry_run_completed") {
    return booleanDirective(context.dry_run_completed, "Dry-run completion was verified.", "Dry-run completion evidence is missing.");
  }
  if (checkKey === "schema_diff_generated") {
    return booleanDirective(context.schema_diff_generated, "Schema diff artifact was verified.", "Schema diff artifact is missing.");
  }
  if (checkKey === "backup_exists") {
    return booleanDirective(context.backup_exists, "Backup artifact was verified.", "Backup artifact is missing.");
  }
  if (checkKey === "required_reviews_passed") {
    return booleanDirective(context.required_reviews_passed, "Required reviews passed.", "Required reviews have not passed.");
  }
  if (checkKey === "branch_protection_satisfied") {
    return booleanDirective(
      context.branch_protection_satisfied,
      "Branch protection is satisfied.",
      "Branch protection is not satisfied."
    );
  }

  return null;
}

function triStateDirective(value: unknown, passingValue: string, passReason: string, failReason: string): EvidenceDirective | null {
  if (value === undefined) return null;
  if (value === passingValue) return { status: "passed", reason: passReason };
  if (value === "unknown") return { status: "missing", reason: failReason };
  return { status: "failed", reason: failReason };
}

function booleanDirective(value: unknown, passReason: string, missingReason: string): EvidenceDirective | null {
  if (value === undefined) return null;
  return value === true ? { status: "passed", reason: passReason } : { status: "missing", reason: missingReason };
}

function readDirective(context: Record<string, unknown>, checkKey: string): EvidenceDirective | null {
  const outcomes = recordFrom(context.evidence_outcomes);
  const value = outcomes[checkKey];
  if (!value) return null;

  if (typeof value === "string") return directiveFromString(value);

  const objectValue = recordFrom(value);
  const status = typeof objectValue.status === "string" ? directiveFromString(objectValue.status) : null;
  if (!status) return null;

  return {
    ...status,
    reason: typeof objectValue.reason === "string" ? objectValue.reason : status.reason
  };
}

function directiveFromString(value: string): EvidenceDirective | null {
  const normalized = value.toLowerCase();
  if (normalized === "passed" || normalized === "pass") return { status: "passed" };
  if (normalized === "failed" || normalized === "fail") return { status: "failed" };
  if (normalized === "missing") return { status: "missing" };
  if (normalized === "failed_once" || normalized === "fail_once") {
    return {
      status: "failed",
      reason: "Deterministic demo evidence is configured to fail once.",
      once: true
    };
  }
  if (normalized === "missing_once") {
    return {
      status: "missing",
      reason: "Deterministic demo evidence is configured to be missing once.",
      once: true
    };
  }
  return null;
}

function defaultReason(label: string, status: EvidenceCheckStatus, role: string): string {
  if (status === "passed") return `${label} verified by ${role}.`;
  if (status === "failed") return `${label} evidence failed in ${role}.`;
  return `${label} evidence is missing after ${role} ran.`;
}

function runtimeModeFor(runtime: EvidenceRuntimeId): string {
  if (runtime === "codex_cli") return "codex_cli_evidence_task_runtime";
  if (runtime === "claude_cli") return "claude_cli_evidence_task_runtime";
  if (runtime === "claude_code_mcp") return "claude_code_mcp_evidence_task_runtime";
  if (runtime === "codex_mcp") return "codex_mcp_evidence_task_runtime";
  if (runtime === "internal_simulated_agent") return "internal_simulated_agent_runtime";
  if (runtime === "native_connector") return "simulated_native_connector_runtime";
  return "deterministic_local_runtime";
}

function runtimeListFrom(value: unknown): EvidenceRuntimeId[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((entry) => {
        const runtime = normalizeEvidenceRuntimeId(entry);
        return runtime ? [runtime] : [];
      })
    )
  ];
}

function contextSummary(context: Record<string, unknown>) {
  return {
    repo: context.repo ?? null,
    service: context.service ?? null,
    environment: context.environment ?? null,
    branch: context.branch ?? null,
    target_branch: context.target_branch ?? null,
    database: context.database ?? null
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
