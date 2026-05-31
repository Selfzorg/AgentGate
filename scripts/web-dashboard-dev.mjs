#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const next = "next";
const useShell = process.platform === "win32";
const parsed = parsePortOption(process.argv.slice(2), process.env.WEB_PORT ?? "3000");
const lockPath = resolve(process.cwd(), "../../.agentgate/run/web-dashboard-dev.lock.json");
const lock = claimDevServerLock(lockPath, parsed.port);

const child = spawn(next, ["dev", "--port", parsed.port, ...parsed.args], {
  stdio: "inherit",
  shell: useShell,
  env: process.env
});

child.on("error", (error) => {
  releaseDevServerLock(lock);
  console.error(`Failed to run next dev: ${error.message}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  releaseDevServerLock(lock);
  child.kill("SIGINT");
});
process.on("SIGTERM", () => {
  releaseDevServerLock(lock);
  child.kill("SIGTERM");
});
process.on("exit", () => releaseDevServerLock(lock));

child.on("exit", (code, signal) => {
  releaseDevServerLock(lock);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function parsePortOption(args, fallbackPort) {
  const remaining = [];
  let port = fallbackPort;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" || arg === "-p") {
      port = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--port=")) {
      port = arg.slice("--port=".length);
    } else {
      remaining.push(arg);
    }
  }

  if (!/^\d+$/.test(port)) {
    console.error(`Invalid WEB_PORT value: ${port}`);
    process.exit(1);
  }

  const numericPort = Number(port);
  if (numericPort < 1 || numericPort > 65535) {
    console.error(`WEB_PORT must be between 1 and 65535, got ${port}`);
    process.exit(1);
  }

  return {
    port: String(numericPort),
    args: remaining
  };
}

function claimDevServerLock(path, port) {
  mkdirSync(dirname(path), { recursive: true });

  const existing = readDevServerLock(path);
  if (existing && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
    console.error(
      `Web dashboard dev server is already running on port ${existing.port} with pid ${existing.pid}. ` +
        "Stop that process before starting another one; concurrent Next dev servers corrupt the shared .next cache."
    );
    process.exit(1);
  }

  const lock = {
    path,
    pid: process.pid,
    port,
    started_at: new Date().toISOString()
  };
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return lock;
}

function readDevServerLock(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseDevServerLock(lock) {
  if (!lock) return;
  const current = readDevServerLock(lock.path);
  if (current?.pid === lock.pid) {
    rmSync(lock.path, { force: true });
  }
}
