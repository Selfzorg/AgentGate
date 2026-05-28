import type { EvidenceTask, GateCheckResult } from "@prisma/client";

export function serializeApproval(
  approval: {
    id: string;
    status: string;
    approvalReadiness: string;
    updatedAt: Date;
  },
  missingChecks: string[]
) {
  return {
    id: approval.id,
    status: approval.status,
    approval_readiness: approval.approvalReadiness,
    missing_checks: missingChecks,
    updated_at: approval.updatedAt.toISOString()
  };
}

export function serializeGateCheck(check: GateCheckResult) {
  return {
    id: check.id,
    check_key: check.checkKey,
    label: check.label,
    status: check.status,
    evidence: check.evidence
  };
}

export function serializeEvidenceTask(task: EvidenceTask) {
  return {
    id: task.id,
    tenant_id: task.tenantId,
    workspace_id: task.workspaceId,
    skill_run_id: task.skillRunId,
    approval_request_id: task.approvalRequestId,
    gate_check_result_id: task.gateCheckResultId,
    trace_id: task.traceId,
    check_key: task.checkKey,
    label: task.label,
    evidence_skill_id: task.evidenceSkillId,
    target_skill_id: task.targetSkillId,
    runtime: task.runtime,
    status: task.status,
    priority: task.priority,
    attempt: task.attempt,
    claimed_by_agent_id: task.claimedByAgentId,
    lease_expires_at: task.leaseExpiresAt?.toISOString() ?? null,
    input: task.input,
    result: task.result,
    error: task.error,
    created_by: task.createdBy,
    claimed_at: task.claimedAt?.toISOString() ?? null,
    started_at: task.startedAt?.toISOString() ?? null,
    completed_at: task.completedAt?.toISOString() ?? null,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString()
  };
}
