#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = "pnpm";
const useShell = process.platform === "win32";
const evidenceRuntimeOptions = ["auto", "codex", "claude", "local", "none"];

export function runDemoLocal(argv = process.argv.slice(2), env = process.env) {
  const options = parseDemoLocalArgs(argv, env);
  const worker = selectEvidenceWorker({ requested: options.evidenceRuntime, env });
  if (worker.error) throw new Error(worker.error);

  const children = [];
  let stopping = false;
  let stopExitCode = 0;
  let forceStopTimer;

  console.log(`AgentGate demo evidence runtime: ${worker.runtimeLabel}${worker.reason ? ` (${worker.reason})` : ""}`);

  const dev = start("dev", ["dev"], {
    WEB_PORT: options.port
  });
  const evidenceWorker = worker.scriptArgs
    ? start(worker.label, worker.scriptArgs, worker.env)
    : null;

  process.on("SIGINT", () => {
    requestStop(130);
  });
  process.on("SIGTERM", () => {
    requestStop(143);
  });

  function start(label, args, extraEnv = {}) {
    const child = spawn(pnpm, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: useShell,
      env: {
        ...env,
        ...extraEnv
      }
    });
    children.push(child);

    child.on("error", (error) => {
      console.error(`Failed to run ${label}: ${error.message}`);
      stopChildren(child);
      process.exit(1);
    });

    child.on("exit", (code, signal) => {
      if (stopping) {
        maybeExitAfterStop();
        return;
      }
      stopChildren(child);
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    });

    return child;
  }

  function requestStop(exitCode) {
    if (stopping) return;
    stopping = true;
    stopExitCode = exitCode;
    stopChildren();
    forceStopTimer = setTimeout(() => process.exit(stopExitCode), 5000);
    forceStopTimer.unref?.();
    maybeExitAfterStop();
  }

  function stopChildren(skipChild = null) {
    for (const child of children) {
      if (child === skipChild || child.killed) continue;
      child.kill("SIGINT");
    }
  }

  function maybeExitAfterStop() {
    if (!stopping) return;
    const allExited = children.every((child) => child.exitCode !== null || child.signalCode !== null);
    if (!allExited) return;
    clearTimeout(forceStopTimer);
    process.exit(stopExitCode);
  }

  void dev;
  void evidenceWorker;
}

export function parseDemoLocalArgs(args, env = process.env) {
  const parsed = {
    port: env.WEB_PORT ?? "3001",
    evidenceRuntime: env.AGENTGATE_DEMO_EVIDENCE_RUNTIME ?? "auto"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" || arg === "-p") {
      parsed.port = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--port=")) {
      parsed.port = arg.slice("--port=".length);
    } else if (arg === "--evidence-runtime" || arg === "--evidence-worker") {
      parsed.evidenceRuntime = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--evidence-runtime=")) {
      parsed.evidenceRuntime = arg.slice("--evidence-runtime=".length);
    } else if (arg.startsWith("--evidence-worker=")) {
      parsed.evidenceRuntime = arg.slice("--evidence-worker=".length);
    } else if (arg === "--no-evidence-worker") {
      parsed.evidenceRuntime = "none";
    } else {
      throw new Error(`Unknown demo local option: ${arg}\n${usage()}`);
    }
  }

  return {
    port: normalizePort(parsed.port),
    evidenceRuntime: normalizeEvidenceRuntimeOption(parsed.evidenceRuntime)
  };
}

export function selectEvidenceWorker({ requested = "auto", env = process.env, commandExists: exists = commandExists } = {}) {
  const mode = normalizeEvidenceRuntimeOption(requested);

  if (mode === "none") {
    return {
      mode,
      label: "evidence worker",
      runtimeLabel: "none",
      reason: "evidence worker disabled",
      scriptArgs: null,
      env: {}
    };
  }

  if (mode === "local") return localWorker("requested local deterministic worker", env);
  if (mode === "codex") {
    return exists("codex") || env.AGENTGATE_EVIDENCE_AGENT_COMMAND
      ? codexWorker("requested Codex evidence worker", env)
      : unavailableWorker("codex", "codex CLI was not found on PATH");
  }
  if (mode === "claude") {
    return exists("claude") || env.AGENTGATE_EVIDENCE_AGENT_COMMAND
      ? claudeWorker("requested Claude evidence worker", env)
      : unavailableWorker("claude", "claude CLI was not found on PATH");
  }

  if (env.AGENTGATE_EVIDENCE_AGENT_COMMAND) {
    const driver = (env.AGENTGATE_EVIDENCE_AGENT_DRIVER ?? "claude").toLowerCase();
    return driver === "codex"
      ? codexWorker("using AGENTGATE_EVIDENCE_AGENT_COMMAND", env)
      : claudeWorker("using AGENTGATE_EVIDENCE_AGENT_COMMAND", env);
  }
  if (exists("codex")) return codexWorker("found codex CLI on PATH", env);
  if (exists("claude")) return claudeWorker("found claude CLI on PATH", env);
  return localWorker("no Codex or Claude CLI found on PATH", env);
}

export function commandExists(command, env = process.env) {
  if (process.platform === "win32") {
    return spawnSync("where.exe", [command], {
      env,
      stdio: "ignore"
    }).status === 0;
  }

  return spawnSync("sh", ["-lc", `command -v ${quoteForShell(command)} >/dev/null 2>&1`], {
    env,
    stdio: "ignore"
  }).status === 0;
}

function codexWorker(reason, env) {
  return agentWorker({
    mode: "codex",
    label: "Codex evidence worker",
    runtimeLabel: "codex_cli",
    reason,
    driver: "codex",
    runtime: "codex_cli",
    agentId: "codex_demo_worker",
    env
  });
}

function claudeWorker(reason, env) {
  return agentWorker({
    mode: "claude",
    label: "Claude evidence worker",
    runtimeLabel: "claude_code_mcp",
    reason,
    driver: "claude",
    runtime: "claude_code_mcp",
    agentId: "claude_demo_worker",
    env
  });
}

function agentWorker({ mode, label, runtimeLabel, reason, driver, runtime, agentId, env }) {
  return {
    mode,
    label,
    runtimeLabel,
    reason,
    scriptArgs: ["evidence:claude-worker"],
    env: {
      AGENTGATE_EVIDENCE_WORKER_AGENT_ID: env.AGENTGATE_EVIDENCE_WORKER_AGENT_ID ?? agentId,
      AGENTGATE_EVIDENCE_AGENT_DRIVER: driver,
      AGENTGATE_EVIDENCE_AGENT_RUNTIME: runtime,
      AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK: env.AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK ?? "4",
      AGENTGATE_EVIDENCE_AGENT_CONCURRENCY: env.AGENTGATE_EVIDENCE_AGENT_CONCURRENCY ?? "1",
      AGENTGATE_EVIDENCE_AGENT_FALLBACK_DETERMINISTIC: env.AGENTGATE_EVIDENCE_AGENT_FALLBACK_DETERMINISTIC ?? "true"
    }
  };
}

function localWorker(reason, env) {
  return {
    mode: "local",
    label: "local deterministic evidence worker",
    runtimeLabel: "local_deterministic",
    reason,
    scriptArgs: ["evidence:worker"],
    env: {
      AGENTGATE_EVIDENCE_WORKER_AGENT_ID: env.AGENTGATE_EVIDENCE_WORKER_AGENT_ID ?? "local_demo_worker"
    }
  };
}

function unavailableWorker(mode, reason) {
  return {
    mode,
    label: "evidence worker",
    runtimeLabel: mode,
    reason,
    scriptArgs: null,
    env: {},
    error: `${reason}. Install it, put it on PATH, set AGENTGATE_EVIDENCE_AGENT_COMMAND, or use --evidence-runtime local.`
  };
}

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${optionName} requires a value.\n${usage()}`);
  return value;
}

function normalizePort(port) {
  if (!/^\d+$/.test(port)) throw new Error(`Invalid WEB_PORT value: ${port}`);

  const numericPort = Number(port);
  if (numericPort < 1 || numericPort > 65535) {
    throw new Error(`WEB_PORT must be between 1 and 65535, got ${port}`);
  }

  return String(numericPort);
}

function normalizeEvidenceRuntimeOption(value) {
  const normalized = String(value ?? "auto").toLowerCase();
  if (evidenceRuntimeOptions.includes(normalized)) return normalized;
  throw new Error(`Invalid evidence runtime: ${value}. Expected one of: ${evidenceRuntimeOptions.join(", ")}.`);
}

function quoteForShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function usage() {
  return "Usage: pnpm demo:local [-- --port 3022] [--evidence-runtime auto|codex|claude|local|none]";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    runDemoLocal();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
