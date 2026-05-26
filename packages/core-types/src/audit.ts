export type AuditEventName =
  | "skill.invocation.received"
  | "skill.classified"
  | "risk.scored"
  | "policy.evaluated"
  | "prerequisites.checked"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "dry_run.started"
  | "dry_run.completed"
  | "credential.issued"
  | "credential.rejected"
  | "execution.queued"
  | "execution.started"
  | "execution.log_emitted"
  | "execution.completed"
  | "execution.failed"
  | "execution.rejected"
  | "audit.finalized";

export type AuditEventInput = {
  trace_id: string;
  skill_run_id?: string;
  event_type: AuditEventName;
  actor_type: "agent" | "user" | "system";
  actor_id?: string;
  metadata: Record<string, unknown>;
};
