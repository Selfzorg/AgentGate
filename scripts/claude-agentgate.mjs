#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function buildClaudeArgs(extraArgs = [], root = repoRoot) {
  const args = [
    "--bare",
    "--add-dir",
    root
  ];

  const settingsPath = join(root, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    args.push("--settings", settingsPath);
  }

  const mcpPath = join(root, ".mcp.json");
  if (existsSync(mcpPath)) {
    args.push("--mcp-config", mcpPath);
  }

  const instructionsPath = join(root, "CLAUDE.md");
  if (existsSync(instructionsPath)) {
    args.push("--append-system-prompt-file", instructionsPath);
  }

  return [...args, ...extraArgs];
}

export function buildClaudeEnv(env = process.env) {
  return {
    ...env,
    AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK: env.AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK ?? "4",
    AGENTGATE_EVIDENCE_AGENT_CONCURRENCY: env.AGENTGATE_EVIDENCE_AGENT_CONCURRENCY ?? "4",
    AGENTGATE_EVIDENCE_WORKER_CONCURRENCY: env.AGENTGATE_EVIDENCE_WORKER_CONCURRENCY ?? "4"
  };
}

async function main() {
  const child = spawn("claude", buildClaudeArgs(process.argv.slice(2)), {
    cwd: repoRoot,
    env: buildClaudeEnv(process.env),
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
