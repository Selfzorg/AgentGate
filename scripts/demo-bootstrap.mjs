#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = "pnpm";
const useShell = process.platform === "win32";
const args = process.argv.slice(2);
const skipPostgres = args.includes("--skip-postgres");
const skipInstall = args.includes("--skip-install");
const unknownArgs = args.filter((arg) => !["--skip-postgres", "--skip-install"].includes(arg));

if (unknownArgs.length > 0) {
  console.error(`Unknown demo bootstrap option(s): ${unknownArgs.join(", ")}`);
  console.error("Usage: pnpm demo:bootstrap [-- --skip-install] [-- --skip-postgres]");
  process.exit(1);
}

const envPath = resolve(repoRoot, ".env");
const initialDatabaseUrl = envFileValue("DATABASE_URL");
if (!existsSync(envPath)) {
  copyFileSync(resolve(repoRoot, ".env.example"), envPath);
  console.log("Created .env from .env.example");
}

if (!skipInstall && dependenciesMissing()) {
  runPnpm(["install"]);
} else if (skipInstall) {
  console.log("Skipping dependency installation because --skip-install was provided.");
}

if (!skipPostgres) {
  runPnpm(["postgres:init"]);
  const nextDatabaseUrl = envFileValue("DATABASE_URL");
  if (nextDatabaseUrl && nextDatabaseUrl !== initialDatabaseUrl) {
    process.env.DATABASE_URL = nextDatabaseUrl;
  }
} else {
  console.log("Skipping local Postgres initialization because --skip-postgres was provided.");
}

runPnpm(["db:generate"]);
runPnpm(["db:deploy"]);
runPnpm(["db:seed"]);
runPnpm(["mcp:build"]);

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

function dependenciesMissing() {
  return requiredPaths().some((candidate) => !existsSync(candidate));
}

function requiredPaths() {
  const prismaBin = process.platform === "win32" ? "prisma.cmd" : "prisma";
  return [
    resolve(repoRoot, "node_modules", ".pnpm"),
    resolve(repoRoot, "node_modules", ".bin", prismaBin),
    resolve(repoRoot, "node_modules", "@electric-sql", "pglite"),
    resolve(repoRoot, "node_modules", "@prisma", "client")
  ].map((candidate) => join(candidate));
}

function envFileValue(name) {
  try {
    const envText = readFileSync(envPath, "utf8");
    const line = envText
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${name}=`));
    if (!line) return null;
    return line.slice(name.length + 1).replace(/^"|"$/g, "");
  } catch {
    return null;
  }
}
