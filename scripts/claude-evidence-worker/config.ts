import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentDriver, ClaudeEvidenceWorkerConfig } from "./types";
import { isFalse, numberFrom, truthy } from "./utils";

const DEFAULT_ALLOWED_TOOLS =
  "Read,Glob,Grep,Bash(pwd),Bash(ls *),Bash(rg *),Bash(git status*),Bash(git log*),Bash(git show*)";
const DEFAULT_DISALLOWED_TOOLS =
  "Edit,Write,MultiEdit,NotebookEdit,Bash(*deploy*),Bash(*merge*),Bash(*push*),Bash(*rm *),Bash(*drop*),Bash(*migrate*),Bash(pnpm test*),Bash(npm test*),Bash(vitest*),Bash(pnpm verify*)";
const CODEX_COMMAND_ENV_KEYS = ["AGENTGATE_EVIDENCE_CODEX_CLI_PATH", "AGENTGATE_CODEX_CLI_PATH", "CODEX_CLI_PATH"];

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ClaudeEvidenceWorkerConfig {
  const driver = driverFrom(env.AGENTGATE_EVIDENCE_AGENT_DRIVER ?? "claude");
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
    driver,
    agentCommand: env.AGENTGATE_EVIDENCE_AGENT_COMMAND,
    codexCommand: driver === "codex" ? resolveCodexCommand(env) : undefined,
    model: env.AGENTGATE_EVIDENCE_AGENT_MODEL || undefined,
    workspaceDir: resolve(env.AGENTGATE_PROJECT_ROOT ?? cwd),
    allowedTools: env.AGENTGATE_EVIDENCE_AGENT_ALLOWED_TOOLS ?? DEFAULT_ALLOWED_TOOLS,
    disallowedTools: env.AGENTGATE_EVIDENCE_AGENT_DISALLOWED_TOOLS ?? DEFAULT_DISALLOWED_TOOLS,
    fallbackToLocalDeterministic: !isFalse(env.AGENTGATE_EVIDENCE_AGENT_FALLBACK_DETERMINISTIC ?? "true"),
    logPath: env.AGENTGATE_EVIDENCE_AGENT_LOG_PATH ?? join(cwd, ".agentgate", "logs", "claude-evidence-worker.jsonl"),
    debug: truthy(env.AGENTGATE_EVIDENCE_WORKER_DEBUG),
    once: process.argv.includes("--once")
  };
}

export function resolveCodexCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of CODEX_COMMAND_ENV_KEYS) {
    const configured = env[key]?.trim();
    if (configured) return configured;
  }

  const configuredPath = resolveCodexPathFromConfig(env);
  if (configuredPath) return configuredPath;

  for (const candidate of platformCodexCandidates(env)) {
    if (existsSync(candidate)) return candidate;
  }

  return undefined;
}

function driverFrom(value: string): AgentDriver {
  const normalized = value.toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "demo" || normalized === "deterministic") return "demo";
  return "claude";
}

function resolveCodexPathFromConfig(env: NodeJS.ProcessEnv): string | undefined {
  const codexHome = env.CODEX_HOME ?? (env.USERPROFILE ? join(env.USERPROFILE, ".codex") : env.HOME ? join(env.HOME, ".codex") : undefined);
  if (!codexHome) return undefined;

  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) return undefined;

  try {
    const config = readFileSync(configPath, "utf8");
    const match = config.match(/^\s*CODEX_CLI_PATH\s*=\s*(['"])(.*?)\1\s*$/m);
    const configuredPath = match?.[2];
    return configuredPath && existsSync(configuredPath) ? configuredPath : undefined;
  } catch {
    return undefined;
  }
}

function platformCodexCandidates(env: NodeJS.ProcessEnv): string[] {
  if (process.platform === "win32") {
    return [
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe") : undefined,
      ...codexBinVersionCandidates(env.LOCALAPPDATA)
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  if (process.platform === "darwin") {
    return ["/Applications/Codex.app/Contents/Resources/codex"];
  }

  return [];
}

function codexBinVersionCandidates(localAppData: string | undefined): string[] {
  if (!localAppData) return [];
  const binDir = join(localAppData, "OpenAI", "Codex", "bin");
  if (!existsSync(binDir)) return [];

  try {
    return readdirSync(binDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(binDir, entry.name, "codex.exe"));
  } catch {
    return [];
  }
}
