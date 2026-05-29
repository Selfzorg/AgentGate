import type { DecisionResponse } from "./api-demo-types";
import type { ApprovalRecord, GateCheckRecord } from "./api-approval-types";

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
