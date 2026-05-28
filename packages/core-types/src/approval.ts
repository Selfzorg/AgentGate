import type { ApprovalStatus, RiskLevel } from "./enums";

export type ApprovalRequestSummary = {
  approval_request_id: string;
  skill_run_id: string;
  status: ApprovalStatus;
  risk_level: RiskLevel;
  approval_readiness: "ready" | "blocked" | "collecting";
  missing_checks: string[];
};
