import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { scoreRisk } from "@agentgate/risk-engine";
import { resolveRegistryCandidate, scanAgentSkills, type RegistryResolutionMatch } from "@agentgate/skill-registry";
import { resolveSkill } from "@agentgate/skill-resolver";
import type { PrismaClient } from "@prisma/client";
import { normalizeActionRequest } from "./action-request-schema";
import { previewGateChecks } from "./gate-check-service";
import { mergeRequiredChecks } from "./imported-skill-governance";
import { loadActivePolicyRules } from "./policy-registry-service";
import {
  resolveImportedRegistrySkill,
  serializeImportedRegistryMatch
} from "./registry-resolution-service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export type PolicySimulationServiceInput = {
  rawRequest: unknown;
  prisma?: PrismaClient | undefined;
  configDir?: string;
  registryRootDir?: string | undefined;
};

export async function simulatePolicyRisk({
  rawRequest,
  prisma,
  configDir = join(repoRoot, "configs"),
  registryRootDir = repoRoot
}: PolicySimulationServiceInput) {
  const request = normalizeActionRequest(rawRequest);
  const [fixtures, registryScan] = await Promise.all([
    loadDemoFixtures(configDir),
    scanAgentSkills({ rootDir: registryRootDir })
  ]);
  const registryResolution = resolveRegistryCandidate({
    candidates: registryScan.candidates,
    rawAction: request.raw_action,
    toolName: request.tool.tool_name
  });
  const importedRegistryResolution = prisma
    ? await resolveImportedRegistrySkill(prisma, {
        tenantId: request.tenant_id,
        workspaceId: request.workspace_id,
        rawAction: request.raw_action,
        toolName: request.tool.tool_name,
        source: request.source,
        context: request.context
      })
    : null;

  const resolvedSkill = importedRegistryResolution?.resolvedSkill ?? resolveSkill({
    rawAction: request.raw_action,
    toolName: request.tool.tool_name,
    context: request.context
  });

  const risk = scoreRisk({
    resolvedSkill,
    rawAction: request.raw_action,
    context: request.context
  });

  const policyRules = prisma
    ? await loadActivePolicyRules(prisma, {
        tenantId: request.tenant_id,
        workspaceId: request.workspace_id,
        fallbackRules: fixtures.policies.rules
      })
    : fixtures.policies.rules;
  const policy = evaluatePolicy({
    rules: policyRules,
    role: request.agent.role,
    skill_id: resolvedSkill.skill_id,
    skill_aliases: resolvedSkill.policy_aliases,
    risk_level: risk.risk_level,
    context: request.context
  });
  const importedRequiredChecks = Array.isArray(resolvedSkill.required_checks) ? resolvedSkill.required_checks : [];
  const importedEvidenceTaskChecks = Array.isArray(resolvedSkill.evidence_tasks)
    ? resolvedSkill.evidence_tasks.map((task) => task.check_key)
    : [];
  const skillRequiredChecks = mergeRequiredChecks(importedRequiredChecks, importedEvidenceTaskChecks);
  const requiredChecks = mergeRequiredChecks(policy.required_checks, skillRequiredChecks);
  const mode = governanceModeFromContext(request.context);
  const effectiveDecision = mode === "enforce" ? policy.decision : "ALLOW";

  const gateChecks = previewGateChecks({
    skillId: resolvedSkill.skill_id,
    requiredChecks,
    evidenceTasks: resolvedSkill.evidence_tasks ?? [],
    context: request.context
  });
  const missingChecks = gateChecks
    .filter((check) => check.status !== "passed")
    .map((check) => check.check_key);
  const skillFixture = fixtures.skills.skills.find((skill) => skill.skill_id === resolvedSkill.skill_id);
  const importedSelected = importedRegistryResolution?.registryResolution.selected ?? null;
  const importedConfig = recordFrom(importedSelected?.candidate.metadata.config);

  return {
    mode: "simulate" as const,
    side_effects: {
      persisted_records: false,
      creates_skill_run: false,
      creates_approval: false,
      creates_dry_run: false,
      issues_token: false,
      queues_execution: false,
      writes_execution_logs: false,
      writes_audit_events: false
    },
    precedence: "DENY > FORCE_DRY_RUN > REQUIRE_APPROVAL > ALLOW",
    rollout_mode: mode,
    policy_rules_source: policyRules === fixtures.policies.rules ? "fixture_fallback" : "database",
    action: {
      tenant_id: request.tenant_id,
      workspace_id: request.workspace_id,
      source: request.source,
      adapter_type: request.adapter_type,
      agent: request.agent,
      tool: request.tool,
      raw_action: request.raw_action,
      context: request.context
    },
    resolved_skill: {
      ...resolvedSkill,
      name: skillFixture?.name ?? importedSelected?.candidate.name ?? resolvedSkill.skill_id,
      connector_id: skillFixture?.connector_id ?? stringFrom(importedConfig.connector_id),
      live_requires_execution_token:
        skillFixture?.live_requires_execution_token ?? booleanFrom(importedConfig.live_requires_execution_token),
      supports_dry_run: skillFixture?.supports_dry_run ?? booleanFrom(importedConfig.supports_dry_run)
    },
    registry_resolution: {
      enabled: true,
      root_dir: registryScan.rootDir,
      candidate_count: registryScan.candidates.length,
      imported_candidate_count: importedRegistryResolution?.registryResolution.candidates.length ?? 0,
      imported_selected: serializeImportedRegistryMatch(importedRegistryResolution?.registryResolution.selected ?? null),
      selected: registryResolution.selected ? serializeRegistryMatch(registryResolution.selected) : null,
      alternatives: registryResolution.alternatives.map(serializeRegistryMatch),
      warnings: registryScan.warnings
    },
    risk: {
      score: risk.risk_score,
      level: risk.risk_level,
      reasons: risk.risk_reasons
    },
    matched_policy: policy.matched_policy
      ? {
          policy_id: policy.matched_policy.policy_id,
          name: policy.matched_policy.name,
          priority: policy.matched_policy.priority,
          decision: policy.matched_policy.decision,
          reason: policy.matched_policy.reason,
          policy_required_checks: policy.required_checks,
          imported_required_checks: skillRequiredChecks,
          imported_evidence_tasks: resolvedSkill.evidence_tasks ?? [],
          required_checks: requiredChecks,
          approvers: policy.approvers
        }
      : null,
    gate_checks: gateChecks,
    decision: effectiveDecision,
    policy_decision: policy.decision,
    reason: mode === "enforce" ? policy.reason : `${mode} mode observed policy decision ${policy.decision}: ${policy.reason}`,
    required_approvers: policy.approvers,
    missing_checks: missingChecks,
    dry_run_required: effectiveDecision === "FORCE_DRY_RUN",
    explanation: buildExplanation({
      decision: effectiveDecision,
      reason: mode === "enforce" ? policy.reason : `${mode} mode observed policy decision ${policy.decision}: ${policy.reason}`,
      policyId: policy.matched_policy?.policy_id ?? null,
      missingChecks
    })
  };
}

function governanceModeFromContext(context: Record<string, unknown>): "observe" | "warn" | "enforce" {
  const raw = context.agentgate_policy_mode ?? context.policy_mode ?? context.governance_mode;
  if (raw === "observe" || raw === "warn" || raw === "enforce") return raw;
  return "enforce";
}

function serializeRegistryMatch(match: RegistryResolutionMatch) {
  return {
    skill_id: match.candidate.skillId,
    name: match.candidate.name,
    source_type: match.candidate.sourceType,
    scope: match.candidate.scope,
    confidence: match.confidence,
    matched_field: match.matchedField,
    content_hash: match.candidate.contentHash,
    side_effect_level: match.candidate.sideEffectLevel,
    default_risk_level: match.candidate.defaultRiskLevel,
    warnings: match.candidate.warnings
  };
}

function buildExplanation({
  decision,
  reason,
  policyId,
  missingChecks
}: {
  decision: string;
  reason: string;
  policyId: string | null;
  missingChecks: string[];
}) {
  const policyPart = policyId ? `Matched ${policyId}.` : "No explicit policy matched; default risk fallback applied.";
  const checksPart = missingChecks.length > 0 ? ` Missing checks: ${missingChecks.join(", ")}.` : " Required checks are satisfied.";
  return `${decision}: ${reason} ${policyPart}${checksPart}`;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function booleanFrom(value: unknown) {
  return value === true;
}
