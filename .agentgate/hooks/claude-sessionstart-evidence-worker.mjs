#!/usr/bin/env node
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runDir = join(repoRoot, ".agentgate", "run");
const logDir = join(repoRoot, ".agentgate", "logs");
const pidPath = join(runDir, "claude-evidence-worker.pid");
const logPath = join(logDir, "claude-evidence-worker.log");
const eventLogPath = join(logDir, "claude-sessionstart-evidence-worker.jsonl");

async function main() {
  const input = await readStdin().catch(() => "");
  await hookLog({ event: "hook.invoked", input: parseJson(input) });

  if (isFalse(process.env.AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART) || process.env.AGENTGATE_EVIDENCE_WORKER_CHILD === "true") {
    await hookLog({ event: "hook.skipped", reason: "autostart disabled or worker child process" });
    return;
  }

  const existingPid = readPid(pidPath);
  if (existingPid && processAlive(existingPid)) {
    await hookLog({ event: "worker.already_running", pid: existingPid });
    process.stdout.write(contextMessage(existingPid, "already running"));
    return;
  }

  await mkdir(runDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  const logFd = openSync(logPath, "a");
  let child;
  try {
    child = spawn("pnpm", ["evidence:claude-worker"], {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AGENTGATE_PROJECT_ROOT: repoRoot,
        AGENTGATE_API_BASE_URL: process.env.AGENTGATE_API_BASE_URL ?? "http://localhost:4000",
        AGENTGATE_TENANT_ID: process.env.AGENTGATE_TENANT_ID ?? "tenant_demo",
        AGENTGATE_WORKSPACE_ID: process.env.AGENTGATE_WORKSPACE_ID ?? "workspace_demo",
        AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK: process.env.AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK ?? "4",
        AGENTGATE_EVIDENCE_AGENT_CONCURRENCY: process.env.AGENTGATE_EVIDENCE_AGENT_CONCURRENCY ?? "4",
        AGENTGATE_EVIDENCE_WORKER_CONCURRENCY: process.env.AGENTGATE_EVIDENCE_WORKER_CONCURRENCY ?? "4",
        AGENTGATE_EVIDENCE_WORKER_AGENT_ID:
          process.env.AGENTGATE_EVIDENCE_WORKER_AGENT_ID ?? stableWorkerAgentId(repoRoot)
      }
    });
  } finally {
    closeSync(logFd);
  }

  child.unref();
  await writeFile(pidPath, `${child.pid}\n`, "utf8");
  await hookLog({ event: "worker.started", pid: child.pid, log_path: logPath });
  process.stdout.write(contextMessage(child.pid, "started"));
}

function contextMessage(pid, state) {
  return [
    `AgentGate Claude evidence worker ${state} for this project (pid ${pid}).`,
    "It polls AgentGate for queued read-only evidence tasks, claims them through the API, runs headless Claude evidence verification, and submits results.",
    "Project default: up to 4 evidence tasks per tick with concurrency 4, unless AGENTGATE_EVIDENCE_AGENT_* overrides are set.",
    "If an approval is collecting, inspect /approvals or the AgentGate audit trace for evidence.task.claimed and evidence.task.completed events.",
    ""
  ].join("\n");
}

function readPid(path) {
  if (!existsSync(path)) return null;
  const parsed = Number(readFileSync(path, "utf8").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isFalse(value) {
  return ["0", "false", "no", "off"].includes(String(value ?? "").toLowerCase());
}

function stableWorkerAgentId(root) {
  const project = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `claude_evidence_worker_${project || "project"}`;
}

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function hookLog(entry) {
  await mkdir(dirname(eventLogPath), { recursive: true });
  await appendFile(eventLogPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, "utf8");
}

function parseJson(value) {
  try {
    return value.trim() ? JSON.parse(value) : null;
  } catch {
    return { raw: value.slice(0, 200) };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? fileURLToPath(import.meta.url)).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    void hookLog({ event: "hook.failed", reason: message });
    console.error(message);
    process.exitCode = 0;
  });
}
