import type { Decision, GovernanceMode, RiskLevel } from "./enums";

export type DecisionResponse = {
  decision: Decision;
  skill_id: string;
  skill_version: string;
  risk_level: RiskLevel;
  risk_score: number;
  risk_reasons: string[];
  reason: string;
  trace_id: string;
  run_id: string;
  mode: GovernanceMode;
  approval_request_id?: string;
  dry_run_required?: boolean;
  missing_checks?: string[];
};
