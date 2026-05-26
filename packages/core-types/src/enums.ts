export type Decision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type AgentSource = "codex" | "claude-code" | "mcp_proxy" | "demo_harness";

export type AdapterType = "hook" | "mcp_proxy" | "simulator";

export type Environment = "dev" | "staging" | "production";

export type GovernanceMode = "observe" | "enforce";

export type SkillRunStatus =
  | "requested"
  | "classified"
  | "policy_evaluated"
  | "dry_run_required"
  | "dry_run_running"
  | "dry_run_completed"
  | "approval_required"
  | "approval_pending"
  | "approved"
  | "denied"
  | "credential_issued"
  | "execution_queued"
  | "executing"
  | "completed"
  | "failed"
  | "rolled_back"
  | "audited";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type ExecutionTokenStatus = "issued" | "used" | "expired" | "revoked";

export type GateCheckStatus = "passed" | "failed" | "missing" | "unknown";

export type LogLevel = "debug" | "info" | "warn" | "error";
