import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { scoreRisk } from "@agentgate/risk-engine";
import { resolveSkill } from "@agentgate/skill-resolver";
import { normalizeActionRequest } from "./action-request-schema";
import { previewGateChecks } from "./gate-check-service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export type PolicySimulationServiceInput = {
  rawRequest: unknown;
  configDir?: string;
};

export async function simulatePolicyRisk({
  rawRequest,
  configDir = join(repoRoot, "configs")
}: PolicySimulationServiceInput) {
  const request = normalizeActionRequest(rawRequest);
  const fixtures = await loadDemoFixtures(configDir);

  const resolvedSkill = resolveSkill({
    rawAction: request.raw_action,
    toolName: request.tool.tool_name,
    context: request.context
  });

  const risk = scoreRisk({
    resolvedSkill,
    rawAction: request.raw_action,
    context: request.context
  });

  const policy = evaluatePolicy({
    rules: fixtures.policies.rules,
    role: request.agent.role,
    skill_id: resolvedSkill.skill_id,
    risk_level: risk.risk_level,
    context: request.context
  });

  const gateChecks = previewGateChecks({
    skillId: resolvedSkill.skill_id,
    requiredChecks: policy.required_checks,
    context: request.context
  });
  const missingChecks = gateChecks
    .filter((check) => check.status !== "passed")
    .map((check) => check.check_key);
  const skillFixture = fixtures.skills.skills.find((skill) => skill.skill_id === resolvedSkill.skill_id);

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
      name: skillFixture?.name ?? resolvedSkill.skill_id,
      connector_id: skillFixture?.connector_id ?? null,
      live_requires_execution_token: skillFixture?.live_requires_execution_token ?? false,
      supports_dry_run: skillFixture?.supports_dry_run ?? false
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
          required_checks: policy.required_checks,
          approvers: policy.approvers
        }
      : null,
    gate_checks: gateChecks,
    decision: policy.decision,
    reason: policy.reason,
    required_approvers: policy.approvers,
    missing_checks: missingChecks,
    dry_run_required: policy.decision === "FORCE_DRY_RUN",
    explanation: buildExplanation({
      decision: policy.decision,
      reason: policy.reason,
      policyId: policy.matched_policy?.policy_id ?? null,
      missingChecks
    })
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
