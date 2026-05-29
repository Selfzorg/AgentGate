#!/usr/bin/env node
/* global process */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("pnpm", ["tsx", "apps/agentgate-cli/src/index.ts", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
