#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const baseDatabaseUrl = process.env.DATABASE_URL ?? envFileValue("DATABASE_URL");

if (!baseDatabaseUrl) {
  console.error("DATABASE_URL is required to create an isolated AgentGate test database.");
  process.exit(1);
}

const explicitTestUrl = process.env.AGENTGATE_TEST_DATABASE_URL;
const testDatabaseUrl = explicitTestUrl ?? derivedTestDatabaseUrl(baseDatabaseUrl);
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\/+/, "");
const shouldDropDatabase = !explicitTestUrl && process.env.AGENTGATE_KEEP_TEST_DB !== "true";

try {
  if (!explicitTestUrl) {
    await createDatabase(baseDatabaseUrl, testDatabaseName);
  }

  run("pnpm", ["prisma", "migrate", "deploy"], { DATABASE_URL: testDatabaseUrl });
  run("pnpm", ["prisma", "db", "seed"], { DATABASE_URL: testDatabaseUrl });
  run("pnpm", ["exec", "vitest", "run", ...args], {
    DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test"
  });
} finally {
  if (shouldDropDatabase) {
    await dropDatabase(baseDatabaseUrl, testDatabaseName).catch((error) => {
      console.error(`Failed to drop isolated test database ${testDatabaseName}: ${error.message}`);
    });
  }
}

function envFileValue(name) {
  try {
    const envText = readFileSync(resolve(repoRoot, ".env"), "utf8");
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

function derivedTestDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const baseName = parsed.pathname.replace(/^\/+/, "");
  if (!baseName || baseName === "postgres") {
    throw new Error("DATABASE_URL must include a non-admin database name.");
  }
  const suffix = `${Date.now()}_${process.pid}`;
  parsed.pathname = `/${baseName}_test_${suffix}`;
  return parsed.toString();
}

async function createDatabase(databaseUrl, databaseName) {
  validateDatabaseName(databaseName);
  const admin = adminClient(databaseUrl);
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.$disconnect();
  }
}

async function dropDatabase(databaseUrl, databaseName) {
  validateDatabaseName(databaseName);
  const admin = adminClient(databaseUrl);
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}

function adminClient(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = "/postgres";
  return new PrismaClient({
    datasources: {
      db: {
        url: parsed.toString()
      }
    }
  });
}

function validateDatabaseName(databaseName) {
  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe database name: ${databaseName}`);
  }
}

function run(command, commandArgs, env) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${process.exitCode}`);
  }
}
