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

export type AuditTraceRecord = {
  trace_id: string;
  skill_run_id: string | null;
  event_count: number;
  event_types: string[];
  first_event_at: string | null;
  latest_event_at: string | null;
  latest_event: {
    id: string;
    event_type: string;
    actor_type: string;
    actor_id: string | null;
    sequence: number | null;
    created_at: string;
  } | null;
  lifecycle: AuditIntegrityRecord;
  run: {
    id: string;
    raw_action: string;
    status: string;
    decision: string | null;
    risk_level: string | null;
    environment: string | null;
    skill_id: string | null;
    skill_name: string | null;
  } | null;
};

export type AuditTraceResponse = {
  audit_traces: AuditTraceRecord[];
};
