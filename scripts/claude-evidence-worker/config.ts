import { join, resolve } from "node:path";
import type { AgentDriver, ClaudeEvidenceWorkerConfig } from "./types";
import { isFalse, numberFrom, truthy } from "./utils";

const DEFAULT_ALLOWED_TOOLS =
  "Read,Glob,Grep,Bash(pwd),Bash(ls *),Bash(rg *),Bash(git status*),Bash(git log*),Bash(git show*)";
const DEFAULT_DISALLOWED_TOOLS =
  "Edit,Write,MultiEdit,NotebookEdit,Bash(*deploy*),Bash(*merge*),Bash(*push*),Bash(*rm *),Bash(*drop*),Bash(*migrate*),Bash(pnpm test*),Bash(npm test*),Bash(vitest*),Bash(pnpm verify*)";

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ClaudeEvidenceWorkerConfig {
  return {
    apiBaseUrl: env.AGENTGATE_API_BASE_URL ?? "http://localhost:4000",
    tenantId: env.AGENTGATE_TENANT_ID ?? "tenant_demo",
    workspaceId: env.AGENTGATE_WORKSPACE_ID ?? "workspace_demo",
    skillRunId: env.AGENTGATE_EVIDENCE_WORKER_SKILL_RUN_ID,
    limit: numberFrom(env.AGENTGATE_EVIDENCE_WORKER_LIMIT, 10),
    maxTasksPerTick: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK, 1),
    concurrency: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_CONCURRENCY, 1),
    intervalMs: numberFrom(env.AGENTGATE_EVIDENCE_WORKER_INTERVAL_MS, 2000),
    leaseSeconds: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_LEASE_SECONDS, 180),
    heartbeatMs: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_HEARTBEAT_MS, 30000),
    agentTimeoutMs: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_TIMEOUT_MS, 300000),
    apiTimeoutMs: numberFrom(env.AGENTGATE_EVIDENCE_AGENT_API_TIMEOUT_MS, 5000),
    agentId: env.AGENTGATE_EVIDENCE_WORKER_AGENT_ID ?? `claude_evidence_worker_${process.pid}`,
    runtime: env.AGENTGATE_EVIDENCE_AGENT_RUNTIME ?? "claude_code_mcp",
    driver: driverFrom(env.AGENTGATE_EVIDENCE_AGENT_DRIVER ?? "claude"),
    agentCommand: env.AGENTGATE_EVIDENCE_AGENT_COMMAND,
    model: env.AGENTGATE_EVIDENCE_AGENT_MODEL,
    workspaceDir: resolve(env.AGENTGATE_PROJECT_ROOT ?? cwd),
    allowedTools: env.AGENTGATE_EVIDENCE_AGENT_ALLOWED_TOOLS ?? DEFAULT_ALLOWED_TOOLS,
    disallowedTools: env.AGENTGATE_EVIDENCE_AGENT_DISALLOWED_TOOLS ?? DEFAULT_DISALLOWED_TOOLS,
    fallbackToLocalDeterministic: !isFalse(env.AGENTGATE_EVIDENCE_AGENT_FALLBACK_DETERMINISTIC ?? "true"),
    logPath: env.AGENTGATE_EVIDENCE_AGENT_LOG_PATH ?? join(cwd, ".agentgate", "logs", "claude-evidence-worker.jsonl"),
    debug: truthy(env.AGENTGATE_EVIDENCE_WORKER_DEBUG),
    once: process.argv.includes("--once")
  };
}

function driverFrom(value: string): AgentDriver {
  const normalized = value.toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "demo" || normalized === "deterministic") return "demo";
  return "claude";
}
