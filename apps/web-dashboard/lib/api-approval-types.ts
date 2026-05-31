import type { DecisionResponse } from "./api-demo-types";

export type GateCheckRecord = {
  id: string;
  check_key: string;
  label: string;
  status: "pending" | "running" | "passed" | "failed" | "missing" | "unknown";
  evidence: Record<string, unknown>;
  evidence_tasks?: Array<{
    id: string;
    status: string;
    runtime: string;
    attempt: number;
    claimed_by_agent_id: string | null;
    lease_expires_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

export type DryRunResultRecord = {
  id: string;
  status: string;
  summary: string;
  result?: Record<string, unknown>;
  artifacts?: unknown;
  created_at: string;
};

export type ApprovalRecord = {
  id: string;
  status: "pending" | "approved" | "denied" | "expired";
  risk_level: "low" | "medium" | "high" | "critical";
  approval_readiness: "ready" | "blocked" | "collecting";
  missing_checks: unknown;
  required_approvers: unknown;
  evidence: Record<string, unknown>;
  comment: string | null;
  created_at: string;
  updated_at: string;
  skill_run: {
    id: string;
    trace_id: string;
    raw_action: string;
    source: string;
    environment: string | null;
    decision: DecisionResponse["decision"] | null;
    status: string;
    reason: string | null;
    risk_score: number | null;
    agent: {
      id: string;
      role: string;
      display_name: string;
    } | null;
    skill: {
      id: string;
      name: string;
    } | null;
    gate_checks: GateCheckRecord[];
    dry_run_result: DryRunResultRecord | null;
  };
};

export type ApprovalRelatedRunRecord = {
  id: string;
  trace_id: string;
  raw_action: string;
  source: string;
  environment: string | null;
  decision: DecisionResponse["decision"] | null;
  status: string;
  reason: string | null;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  risk_score: number | null;
  created_at: string;
  updated_at: string;
  agent: {
    id: string;
    role: string;
    display_name: string;
  } | null;
  skill: {
    id: string;
    name: string;
  } | null;
  gate_checks: GateCheckRecord[];
  dry_run_result: DryRunResultRecord | null;
};

export type ApprovalQueueResponse = {
  approvals: ApprovalRecord[];
  related_runs?: ApprovalRelatedRunRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    has_more: boolean;
  };
};

export type ApprovalActionResponse = {
  approval: {
    id: string;
    status: ApprovalRecord["status"];
    approval_readiness: string;
    missing_checks: unknown;
    comment: string | null;
    updated_at: string;
  };
};

export type DryRunResponse = {
  dry_run_result: {
    id: string;
    status: string;
    summary: string;
    result: Record<string, unknown>;
    artifacts: unknown;
  };
  decision: DecisionResponse["decision"];
  missing_checks: string[];
  approval?: {
    id: string;
    status: ApprovalRecord["status"];
    approval_readiness: string;
    missing_checks: unknown;
    comment: string | null;
    updated_at: string;
  };
  gate_checks?: GateCheckRecord[];
  evidence_tasks?: Array<{
    id: string;
    check_key: string;
    status: string;
    runtime: string;
    attempt: number;
  }>;
};

export type EvidenceRetryResponse = {
  approval: {
    id: string;
    status: ApprovalRecord["status"];
    approval_readiness: string;
    missing_checks: string[];
    updated_at: string;
  };
  gate_checks: GateCheckRecord[];
  evidence_tasks?: Array<{
    id: string;
    check_key: string;
    status: string;
    runtime: string;
    attempt: number;
  }>;
  missing_checks: string[];
};
