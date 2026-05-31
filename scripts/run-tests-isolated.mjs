#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const baseDatabaseUrl = process.env.DATABASE_URL ?? envFileValue("DATABASE_URL");

if (!baseDatabaseUrl) {
  console.error("DATABASE_URL is required to create an isolated AgentGate test database.");
  process.exit(1);
}

const explicitTestUrl = process.env.AGENTGATE_TEST_DATABASE_URL;
const schemaIsolation = !explicitTestUrl && shouldUseSchemaIsolation(baseDatabaseUrl);
const schemaIsolationConfig = schemaIsolation ? derivedTestSchemaUrl(baseDatabaseUrl) : null;
const testDatabaseUrl = explicitTestUrl ?? schemaIsolationConfig?.databaseUrl ?? derivedTestDatabaseUrl(baseDatabaseUrl);
const setupDatabaseUrl = prismaSetupUrl(testDatabaseUrl);
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\/+/, "");
const shouldDropDatabase = !explicitTestUrl && !schemaIsolation && process.env.AGENTGATE_KEEP_TEST_DB !== "true";
const shouldDropSchema = Boolean(schemaIsolationConfig) && process.env.AGENTGATE_KEEP_TEST_DB !== "true";

try {
  if (schemaIsolationConfig) {
    await createSchema(baseDatabaseUrl, schemaIsolationConfig.schemaName);
  } else if (!explicitTestUrl) {
    await createDatabase(baseDatabaseUrl, testDatabaseName);
  }

  run("pnpm", ["prisma", "migrate", "deploy"], { DATABASE_URL: setupDatabaseUrl });
  run("pnpm", ["prisma", "db", "seed"], { DATABASE_URL: setupDatabaseUrl });
  run("pnpm", ["exec", "vitest", "run", ...vitestArgsFor(testDatabaseUrl, args)], {
    DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test"
  });
} finally {
  if (shouldDropSchema && schemaIsolationConfig) {
    await dropSchema(baseDatabaseUrl, schemaIsolationConfig.schemaName).catch((error) => {
      console.error(`Failed to drop isolated test schema ${schemaIsolationConfig.schemaName}: ${error.message}`);
    });
  }

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

function shouldUseSchemaIsolation(databaseUrl) {
  if (process.env.AGENTGATE_TEST_ISOLATION === "schema") return true;
  if (process.env.AGENTGATE_TEST_ISOLATION === "database") return false;

  const parsed = new URL(databaseUrl);
  const baseName = parsed.pathname.replace(/^\/+/, "");
  return baseName === "postgres";
}

function vitestArgsFor(databaseUrl, requestedArgs) {
  if (!shouldSerializeVitest(databaseUrl, requestedArgs)) return requestedArgs;
  return ["--no-file-parallelism", "--maxWorkers=1", "--maxConcurrency=1", ...requestedArgs];
}

function shouldSerializeVitest(databaseUrl, requestedArgs) {
  if (process.env.AGENTGATE_TEST_SERIAL === "true") return true;
  if (process.env.AGENTGATE_TEST_SERIAL === "false") return false;
  if (
    requestedArgs.some(
      (arg) => arg === "--no-file-parallelism" || arg === "--fileParallelism=false" || arg.startsWith("--maxWorkers")
    )
  ) {
    return false;
  }

  const parsed = new URL(databaseUrl);
  return parsed.searchParams.get("pgbouncer") === "true";
}

function derivedTestSchemaUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const schemaName = `agentgate_test_${Date.now()}_${process.pid}`;
  parsed.searchParams.set("schema", schemaName);

  return {
    databaseUrl: parsed.toString(),
    schemaName
  };
}

function prismaSetupUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("statement_cache_size", "0");
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

async function createSchema(databaseUrl, schemaName) {
  validateDatabaseName(schemaName);
  const admin = adminClient(databaseUrl);
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
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

async function dropSchema(databaseUrl, schemaName) {
  validateDatabaseName(schemaName);
  const admin = adminClient(databaseUrl);
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
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
        url: prismaSetupUrl(parsed.toString())
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
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.error) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${process.exitCode}`);
  }
}
