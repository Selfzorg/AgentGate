import type { DemoActionCard, DecisionResponse } from "./api-demo-types";
import type { GateCheckRecord } from "./api-approval-types";

export type RiskScannerSample = {
  id: string;
  label: string;
  description: string;
  expected_decision: DemoActionCard["expected_decision"];
  payload: Record<string, unknown>;
  payload_preview: Record<string, unknown>;
};

export type RiskScannerSimulation = {
  mode: "simulate";
  side_effects: Record<string, boolean>;
  precedence: string;
  rollout_mode: "observe" | "warn" | "enforce";
  policy_rules_source: "fixture_fallback" | "database";
  action: {
    raw_action: string;
    source: string;
    adapter_type: string;
    agent: {
      agent_id: string;
      agent_type: string;
      role: string;
    };
    tool: {
      tool_name: string;
    };
    context: Record<string, unknown>;
  };
  resolved_skill: {
    skill_id: string;
    skill_version: string;
    category: string;
    default_risk_level: string;
    confidence: number;
    resolver_reason: string;
    matched_pattern?: string;
    name: string;
    connector_id: string | null;
    live_requires_execution_token: boolean;
    supports_dry_run: boolean;
  };
  registry_resolution: {
    enabled: boolean;
    root_dir: string;
    candidate_count: number;
    imported_candidate_count: number;
    imported_selected: RegistryResolutionSelection | null;
    selected: RegistryResolutionSelection | null;
    alternatives: RegistryResolutionSelection[];
    warnings: string[];
  };
  risk: {
    score: number;
    level: "low" | "medium" | "high" | "critical";
    reasons: string[];
  };
  matched_policy: {
    policy_id: string;
    name: string;
    priority: number;
    decision: DecisionResponse["decision"];
    reason: string;
    required_checks: string[];
    approvers: string[];
  } | null;
  gate_checks: Array<{
    check_key: string;
    label: string;
    status: GateCheckRecord["status"];
    evidence: Record<string, unknown>;
  }>;
  decision: DecisionResponse["decision"];
  reason: string;
  required_approvers: string[];
  missing_checks: string[];
  dry_run_required: boolean;
  explanation: string;
};

type RegistryResolutionSelection = {
  skill_id: string;
  skill_version?: string | null;
  skill_version_id?: string | null;
  name: string;
  source_type: string;
  scope: string;
  confidence: number;
  matched_field: string;
  content_hash: string;
  side_effect_level: string;
  default_risk_level: "low" | "medium" | "high" | "critical";
  warnings: string[];
};
