#!/usr/bin/env node
import { spawn } from "node:child_process";

const next = "next";
const useShell = process.platform === "win32";
const parsed = parsePortOption(process.argv.slice(2), process.env.WEB_PORT ?? "3000");

const child = spawn(next, ["dev", "--port", parsed.port, ...parsed.args], {
  stdio: "inherit",
  shell: useShell,
  env: process.env
});

child.on("error", (error) => {
  console.error(`Failed to run next dev: ${error.message}`);
  process.exit(1);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

child.on("exit", (code, signal) => {
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
