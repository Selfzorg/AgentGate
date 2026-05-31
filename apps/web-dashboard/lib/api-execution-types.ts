import type { DecisionResponse } from "./api-demo-types";
import type { AuditEventRecord } from "./api-audit-types";
import type { ApprovalRecord, GateCheckRecord } from "./api-approval-types";

export type ExecutionTokenSummary = {
  execution_token_id: string;
  skill_run_id: string;
  approval_id: string | null;
  scopes: string[];
  ttl_seconds: number;
  token_type: "agentgate_bearer";
  token_value_available: boolean;
  token_value?: string;
  status: "issued" | "used" | "expired" | "revoked";
  expires_at: string;
};

export type ClaudeHandoffResponse = {
  claude_handoff: {
    run_id: string;
    trace_id: string;
    status: string;
    command: string;
    instructions: string;
    skill: {
      skill_id: string;
      name: string;
      source_type: string;
      approved_hash: string | null;
      version: string | null;
    };
    execution_token: ExecutionTokenSummary;
    safety: {
      approval_status: string;
      token_scope: string[];
      token_expires_at: string;
      skill_hash_verified: boolean;
      raw_token_returned_once: boolean;
    };
  };
};

export type ExecutionLogRecord = {
  id: string;
  sequence: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ExecutionAttemptRecord = {
  id: string;
  execution_token_id: string | null;
  idempotency_key: string;
  status: string;
  result: Record<string, unknown>;
  error: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type SkillRunListRecord = {
  id: string;
  trace_id: string;
  created_at: string;
  updated_at: string;
  agent: {
    id: string;
    role: string;
    display_name: string;
  } | null;
  source: string;
  adapter_type: string;
  raw_action: string;
  skill_id: string | null;
  environment: string | null;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  risk_score: number | null;
  decision: DecisionResponse["decision"] | null;
  status: string;
  reason: string | null;
  matched_policy_id: string | null;
  approval: {
    id: string;
    status: ApprovalRecord["status"];
    approval_readiness: ApprovalRecord["approval_readiness"];
    updated_at: string;
  } | null;
  counts: {
    approvals: number;
    gate_checks: number;
    evidence_tasks: number;
    execution_logs: number;
    audit_events: number;
    execution_tokens: number;
    attempts: number;
  };
  gate_check_summary: {
    total: number;
    passed: number;
    running: number;
    pending: number;
    missing: number;
    failed: number;
    unknown: number;
  };
  no_gate_check_reason: string | null;
  latest_audit_event: {
    id: string;
    event_type: string;
    sequence: number | null;
    created_at: string;
  } | null;
  next_action: string;
};

export type SkillRunListResponse = {
  skill_runs: SkillRunListRecord[];
};

export type SkillRunDetailResponse = {
  skill_run: {
    id: string;
    trace_id: string;
    raw_action: string;
    source: string;
    adapter_type: string;
    environment: string | null;
    decision: DecisionResponse["decision"] | null;
    risk_level: "low" | "medium" | "high" | "critical" | null;
    risk_score: number | null;
    risk_reasons: unknown;
    status: string;
    reason: string | null;
    resolved_skill: {
      skill_id: string;
      skill_version: string;
      category: string;
      default_risk_level: "low" | "medium" | "high" | "critical" | string;
      confidence: number;
      resolver_reason: string;
      resolver_source?: "imported_registry" | "static_fallback" | string;
      matched_field?: "skill_id" | "name" | "path" | "description" | string;
      source_fingerprint?: {
        source_type?: string;
        path?: string;
        content_hash?: string;
        skill_version_id?: string | null;
      };
    } | null;
    approval_request: {
      id: string;
      status: ApprovalRecord["status"];
      approvalReadiness?: string;
      approval_readiness?: string;
    } | null;
    dry_run_result: unknown;
    gate_checks: GateCheckRecord[];
    execution_tokens: Array<{
      id: string;
      status: ExecutionTokenSummary["status"];
      scopes: unknown;
      environment: string | null;
      approval_request_id: string | null;
      expires_at: string;
      used_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>;
    attempts: ExecutionAttemptRecord[];
    execution_logs: ExecutionLogRecord[];
    ai_analysis: AiRunAnalysisRecord | null;
    audit_events: AuditEventRecord[];
  };
};

export type AiRunAnalysisRecord = {
  id: string;
  skill_run_id: string;
  trace_id: string;
  summary: string;
  severity: "info" | "low" | "medium" | "high" | "critical" | string;
  risk_notes: unknown;
  missing_evidence: unknown;
  suggested_actions: unknown;
  failure_cause: string | null;
  approver_notes: string | null;
  model: string;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_cents: number;
  status: "completed" | "failed" | "disabled" | string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type IssueExecutionTokenResponse = {
  execution_token: ExecutionTokenSummary;
};

export type ExecuteSkillRunResponse = {
  run_id: string;
  status: "execution_queued" | "duplicate";
  attempt_id?: string;
  original_run_status?: string;
  logs_url: string;
};
