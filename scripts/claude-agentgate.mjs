import { existsSync, readFileSync } from "node:fs";
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

  const localSettings = loadLocalSettings(root);
  const localModel = stringSetting(localSettings.model) || stringSetting(localSettings.env?.ANTHROPIC_MODEL);
  if (localModel && !hasModelOverride(extraArgs)) {
    args.push("--model", localModel);
  }

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

export function buildClaudeEnv(env = process.env, root = repoRoot) {
  const localEnv = settingsEnv(loadLocalSettings(root));
  const mergedEnv = {
    ...env,
    ...localEnv
  };

  return {
    ...mergedEnv,
    AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK: mergedEnv.AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK ?? "4",
    AGENTGATE_EVIDENCE_AGENT_CONCURRENCY: mergedEnv.AGENTGATE_EVIDENCE_AGENT_CONCURRENCY ?? "4",
    AGENTGATE_EVIDENCE_WORKER_CONCURRENCY: mergedEnv.AGENTGATE_EVIDENCE_WORKER_CONCURRENCY ?? "4"
  };
}

function loadLocalSettings(root) {
  const settingsPath = join(root, ".claude", "settings.local.json");
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${settingsPath}: ${message}`);
  }
}

function settingsEnv(settings) {
  if (!isRecord(settings.env)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(settings.env)
      .filter(([key, value]) => key && value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

function stringSetting(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasModelOverride(args) {
  return args.some((arg) => arg === "--model" || arg.startsWith("--model="));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const child = spawn("claude", buildClaudeArgs(process.argv.slice(2)), {
    cwd: repoRoot,
    env: buildClaudeEnv(process.env),
    shell: process.platform === "win32",
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
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      console.error(
        [
          "Claude Code CLI was not found on PATH.",
          "Install it with: npm install -g @anthropic-ai/claude-code",
          "Then open a new terminal and run: pnpm claude:agentgate"
        ].join("\n")
      );
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
