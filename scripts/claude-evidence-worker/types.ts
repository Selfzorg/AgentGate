export type EvidenceStatus = "passed" | "failed" | "missing";
export type AgentDriver = "claude" | "codex" | "demo";
export type WorkerStatus = "online" | "idle" | "busy" | "offline" | "error";

export type EvidenceTask = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  skill_run_id: string;
  trace_id: string;
  check_key: string;
  label: string;
  runtime: string;
  status: string;
  attempt: number;
  input: Record<string, unknown>;
};

export type AgentEvidenceResult = {
  status: EvidenceStatus;
  reason: string;
  evidence: Record<string, unknown>;
};

export type ClaudeEvidenceWorkerConfig = {
  apiBaseUrl: string;
  tenantId: string;
  workspaceId: string;
  skillRunId: string | undefined;
  limit: number;
  maxTasksPerTick: number;
  concurrency: number;
  intervalMs: number;
  leaseSeconds: number;
  heartbeatMs: number;
  agentTimeoutMs: number;
  apiTimeoutMs: number;
  agentId: string;
  runtime: string;
  driver: AgentDriver;
  agentCommand: string | undefined;
  model: string | undefined;
  workspaceDir: string;
  allowedTools: string;
  disallowedTools: string;
  fallbackToLocalDeterministic: boolean;
  logPath: string;
  debug: boolean;
  once: boolean;
};

export type WorkerDeps = {
  fetchImpl?: typeof fetch | undefined;
  runAgentEvidence?: ((task: EvidenceTask, config: ClaudeEvidenceWorkerConfig) => Promise<AgentEvidenceResult>) | undefined;
  writeLog?: ((entry: Record<string, unknown>) => Promise<void>) | undefined;
};

export type WorkerTickResult = {
  scanned: number;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
};

export type TaskOutcome = {
  claimed: boolean;
  completed: boolean;
  failed: boolean;
  skipped: boolean;
};
