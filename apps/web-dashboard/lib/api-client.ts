export type DemoActionCard = {
  id: string;
  label: string;
  description: string;
  expected_decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
  button_label: string;
  payload_preview: Record<string, unknown>;
};

export type DemoActionsResponse = {
  actions: DemoActionCard[];
};

export type DecisionResponse = {
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
  skill_id: string;
  skill_version: string;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_score: number;
  risk_reasons: string[];
  reason: string;
  trace_id: string;
  run_id: string;
  mode: "observe" | "enforce";
  dry_run_required?: boolean;
  missing_checks?: string[];
};

export type DemoReplayResponse = {
  action_id: string;
  decision: DecisionResponse;
};

export type DemoScenarioReplayResponse = {
  scenario: string;
  decisions: DemoReplayResponse[];
  executions?: Array<{
    action_id: string;
    step: string;
    result: unknown;
  }>;
  runner?: {
    scanned: number;
    claimed: number;
  };
};

export type LiveActivity = {
  time: string;
  updated_at?: string;
  run_id: string;
  trace_id: string;
  agent_id: string | null;
  agent_display_name: string | null;
  role: string | null;
  source: string;
  raw_action: string;
  skill_id: string | null;
  environment: string | null;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  risk_score: number | null;
  decision: DecisionResponse["decision"] | null;
  status: string;
  reason: string | null;
  matched_policy_id: string | null;
  latest_audit_event?: {
    event_type: string;
    sequence: number | null;
    created_at: string;
  } | null;
};

export type LiveActivityResponse = {
  activities: LiveActivity[];
};

export type SkillRecord = {
  id: string;
  skill_id: string;
  name: string;
  category: string;
  default_risk_level: "low" | "medium" | "high" | "critical";
  description: string | null;
  version: string;
  connector: string | null;
  execution: Record<string, unknown>;
};

export type PolicyRecord = {
  id: string;
  policy_id: string;
  name: string;
  version: string;
  priority: number;
  decision: DecisionResponse["decision"];
  reason: string;
  definition: Record<string, unknown>;
  required_checks: unknown;
  approvers: unknown;
};

export type AuditEventRecord = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  skill_run_id: string | null;
  trace_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  sequence: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditIntegrityRecord = {
  trace_id: string | null;
  skill_run_id: string | null;
  complete: boolean;
  lifecycle_status: string | null;
  required_events: string[];
  observed_events: string[];
  missing_events: string[];
  sequence: {
    event_count: number;
    complete: boolean;
    issues: string[];
  };
  checked_at: string;
};

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

export type ApprovalQueueResponse = {
  approvals: ApprovalRecord[];
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

export type EvidenceWorkerRecord = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  agent_id: string;
  runtime: string;
  driver: string;
  status: "online" | "idle" | "busy" | "offline" | "error";
  effective_status: "online" | "idle" | "busy" | "offline" | "error";
  stale: boolean;
  current_task_id: string | null;
  current_check_key: string | null;
  processed_count: number;
  failed_count: number;
  metadata: Record<string, unknown>;
  heartbeat_age_ms: number;
  last_heartbeat_at: string;
  started_at: string;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EvidenceMonitorTaskRecord = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  skill_run_id: string;
  approval_request_id: string | null;
  gate_check_result_id: string;
  trace_id: string;
  check_key: string;
  label: string;
  evidence_skill_id: string;
  target_skill_id: string;
  runtime: string;
  status: "queued" | "claimed" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
  priority: number;
  attempt: number;
  claimed_by_agent_id: string | null;
  lease_expires_at: string | null;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  error: Record<string, unknown>;
  created_by: string | null;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  gate_check_status: GateCheckRecord["status"];
  gate_check_evidence: Record<string, unknown>;
  approval: {
    id: string;
    status: ApprovalRecord["status"];
    approval_readiness: ApprovalRecord["approval_readiness"];
  } | null;
  skill_run: {
    id: string;
    raw_action: string;
    status: string;
    decision: DecisionResponse["decision"] | null;
    environment: string | null;
  };
};

export type EvidenceMonitorEventRecord = {
  id: string;
  skill_run_id: string | null;
  trace_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  sequence: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type EvidenceMonitorResponse = {
  generated_at: string;
  tenant_id: string;
  workspace_id: string;
  queue: {
    queued: number;
    claimed: number;
    running: number;
    succeeded: number;
    failed: number;
    timed_out: number;
    cancelled: number;
    active: number;
    terminal: number;
    total: number;
  };
  workers: EvidenceWorkerRecord[];
  tasks: EvidenceMonitorTaskRecord[];
  events: EvidenceMonitorEventRecord[];
};

export type EvidenceTaskActionResponse = {
  evidence_task: EvidenceMonitorTaskRecord;
};

export type ClearEvidenceQueueResponse = {
  cancelled_count: number;
  affected_run_count: number;
  affected_runs: string[];
};

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

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export async function getDemoActions(): Promise<DemoActionsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/demo/actions`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load demo actions: ${response.status}`);
  }

  return (await response.json()) as DemoActionsResponse;
}

export async function replayDemoAction(actionId: string): Promise<Response> {
  return fetch(`${apiBaseUrl}/api/v1/demo/actions/${actionId}/replay`, {
    method: "POST"
  });
}

export async function replayDemoActionJson(actionId: string): Promise<DemoReplayResponse> {
  const response = await replayDemoAction(actionId);

  if (!response.ok) {
    throw new Error(`Failed to replay demo action: ${response.status}`);
  }

  return (await response.json()) as DemoReplayResponse;
}

export async function replayDemoScenario(): Promise<DemoScenarioReplayResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/demo/scenario/replay`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Failed to replay demo scenario: ${response.status}`);
  }

  return (await response.json()) as DemoScenarioReplayResponse;
}

export async function getRiskScannerSamples(): Promise<{ samples: RiskScannerSample[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/risk-scanner/samples`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load risk scanner samples: ${response.status}`);
  }

  return (await response.json()) as { samples: RiskScannerSample[] };
}

export async function simulateRisk(payload: Record<string, unknown>): Promise<RiskScannerSimulation> {
  const response = await fetch(`${apiBaseUrl}/api/v1/risk-scanner/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as RiskScannerSimulation;
}

export async function getLiveActivity(): Promise<LiveActivityResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/live/activity`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load live activity: ${response.status}`);
  }

  return (await response.json()) as LiveActivityResponse;
}

export async function getSkills(): Promise<{ skills: SkillRecord[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skills`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load skills: ${response.status}`);
  }

  return (await response.json()) as { skills: SkillRecord[] };
}

export async function getPolicies(): Promise<{ policies: PolicyRecord[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/policies`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load policies: ${response.status}`);
  }

  return (await response.json()) as { policies: PolicyRecord[] };
}

export async function getAuditEventsByTrace(traceId: string): Promise<{ audit_events: AuditEventRecord[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/audit-events?trace_id=${encodeURIComponent(traceId)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load audit events: ${response.status}`);
  }

  return (await response.json()) as { audit_events: AuditEventRecord[] };
}

export async function getAuditIntegrityByTrace(traceId: string): Promise<{ audit_integrity: AuditIntegrityRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/audit-integrity?trace_id=${encodeURIComponent(traceId)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load audit integrity: ${response.status}`);
  }

  return (await response.json()) as { audit_integrity: AuditIntegrityRecord };
}

export async function getApprovals(
  options: { limit?: number; offset?: number; status?: ApprovalRecord["status"]; q?: string } = {}
): Promise<ApprovalQueueResponse> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  if (options.status) query.set("status", options.status);
  if (options.q) query.set("q", options.q);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals${suffix}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load approvals: ${response.status}`);
  }

  return (await response.json()) as ApprovalQueueResponse;
}

export async function approveApproval(approvalId: string, comment: string): Promise<ApprovalActionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ApprovalActionResponse;
}

export async function denyApproval(approvalId: string, comment: string): Promise<ApprovalActionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}/deny`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ApprovalActionResponse;
}

export async function forceDryRun(approvalId: string): Promise<DryRunResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}/force-dry-run`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as DryRunResponse;
}

export async function retryApprovalEvidence(approvalId: string, checkKey?: string): Promise<EvidenceRetryResponse> {
  const suffix = checkKey ? `/evidence/${encodeURIComponent(checkKey)}/retry` : "/evidence/retry";
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}${suffix}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as EvidenceRetryResponse;
}

export async function getEvidenceMonitor(): Promise<EvidenceMonitorResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-monitor?tenant_id=tenant_demo&workspace_id=workspace_demo`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load evidence monitor: ${response.status}`);
  }

  return (await response.json()) as EvidenceMonitorResponse;
}

export async function prioritizeEvidenceTask(taskId: string): Promise<EvidenceTaskActionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/prioritize`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as EvidenceTaskActionResponse;
}

export async function clearActiveEvidenceQueue(): Promise<ClearEvidenceQueueResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-tasks/clear-active`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      workspace_id: "workspace_demo",
      reason: "Cleared from Evidence Monitor."
    })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ClearEvidenceQueueResponse;
}

export async function runSkillRunDryRun(runId: string): Promise<DryRunResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/dry-run`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as DryRunResponse;
}

export async function getSkillRun(runId: string): Promise<SkillRunDetailResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load skill run: ${response.status}`);
  }

  return (await response.json()) as SkillRunDetailResponse;
}

export async function getRunAiAnalysis(runId: string): Promise<{ ai_analysis: AiRunAnalysisRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/ai-analysis`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load AI analysis: ${response.status}`);
  }

  return (await response.json()) as { ai_analysis: AiRunAnalysisRecord };
}

export async function generateRunAiAnalysis(runId: string): Promise<{ ai_analysis: AiRunAnalysisRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/ai-analysis`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { ai_analysis: AiRunAnalysisRecord };
}

export async function issueExecutionToken(
  runId: string,
  approvalId?: string | null
): Promise<IssueExecutionTokenResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/execution-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      skill_run_id: runId,
      ...(approvalId ? { approval_id: approvalId } : {})
    })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as IssueExecutionTokenResponse;
}

export async function executeSkillRun(
  runId: string,
  input: {
    execution_token_id?: string;
    execution_token?: string;
    idempotency_key: string;
  }
): Promise<ExecuteSkillRunResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ExecuteSkillRunResponse;
}

export function getSkillRunLogsUrl(runId: string): string {
  return `${apiBaseUrl}/api/v1/skill-runs/${runId}/logs`;
}
