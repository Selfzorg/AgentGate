import type { GateCheckResult, GateCheckStatus } from "@prisma/client";

export type EvidenceStatus = Exclude<GateCheckStatus, "pending" | "running" | "unknown">;

export const ACTIVE_EVIDENCE_TASK_STATUSES = ["queued", "claimed", "running"] as const;

export type EvidenceRun = {
  id: string;
  tenantId: string;
  workspaceId: string;
  traceId: string;
  rawAction: string;
  context: unknown;
  resolvedSkillSnapshot: unknown;
  skill: { skillId: string } | null;
  approvalRequest: { id: string; status: string } | null;
  gateCheckResults: GateCheckResult[];
};

export type EvidenceTaskResultInput = {
  status: EvidenceStatus;
  reason: string;
  evidence?: Record<string, unknown> | undefined;
};
