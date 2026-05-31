#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = "pnpm";
const useShell = process.platform === "win32";

runPnpm(["db:seed"]);

const demoLog = resolve(repoRoot, "ecommerce_operations.log");
if (existsSync(demoLog)) {
  rmSync(demoLog, { force: true });
  console.log("Removed ecommerce_operations.log");
}

function runPnpm(commandArgs) {
  const result = spawnSync(pnpm, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: useShell
  });

  if (result.error) {
    console.error(`Failed to run pnpm ${commandArgs.join(" ")}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
