import type { Decision, DemoPolicyRule, RiskLevel } from "@agentgate/core-types";
import { sortPoliciesByPrecedence } from "./precedence";

export function selectFirstPolicyByPrecedence(rules: DemoPolicyRule[]): DemoPolicyRule | undefined {
  return sortPoliciesByPrecedence(rules)[0];
}

export type PolicyEvaluationInput = {
  rules: DemoPolicyRule[];
  role: string;
  skill_id: string;
  skill_aliases?: string[] | undefined;
  risk_level: RiskLevel;
  context: Record<string, unknown>;
};

export type PolicyEvaluationResult = {
  decision: Decision;
  reason: string;
  matched_policy?: DemoPolicyRule;
  required_checks: string[];
  approvers: string[];
};

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const matchedPolicy = sortPoliciesByPrecedence(input.rules).find((rule) =>
    policyRuleMatches(rule, input)
  );

  if (matchedPolicy) {
    return {
      decision: matchedPolicy.decision,
      reason: matchedPolicy.reason,
      matched_policy: matchedPolicy,
      required_checks: matchedPolicy.required_checks ?? [],
      approvers: matchedPolicy.approvers ?? []
    };
  }

  if (input.risk_level === "high" || input.risk_level === "critical") {
    return {
      decision: "REQUIRE_APPROVAL",
      reason: "High-risk action requires approval by default.",
      required_checks: [],
      approvers: ["service_owner"]
    };
  }

  return {
    decision: "ALLOW",
    reason: "No blocking policy matched this low-risk or medium-risk action.",
    required_checks: [],
    approvers: []
  };
}

function policyRuleMatches(rule: DemoPolicyRule, input: PolicyEvaluationInput): boolean {
  return Object.entries(rule.when).every(([key, expected]) => {
    const actual = valueForPolicyKey(key, input);
    if (key === "skill" && typeof expected === "string" && Array.isArray(actual)) {
      return actual.includes(expected);
    }
    return actual === expected;
  });
}

function valueForPolicyKey(key: string, input: PolicyEvaluationInput): unknown {
  if (key === "role") return input.role;
  if (key === "skill") return [input.skill_id, ...(input.skill_aliases ?? [])];
  return input.context[key];
}
