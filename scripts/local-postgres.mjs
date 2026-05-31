#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "";
const envFile = readEnvFile();
const databaseUrl = process.env.DATABASE_URL ?? envFile.DATABASE_URL ?? null;
const parsedLocalDatabaseUrl = parseLocalDatabaseUrl(databaseUrl);
const shouldSkipLocalPostgres =
  databaseUrl && !parsedLocalDatabaseUrl && process.env.AGENTGATE_FORCE_LOCAL_POSTGRES !== "true";
const validCommands = new Set(["init", "start", "stop"]);

if (!validCommands.has(command)) {
  console.error("Usage: pnpm postgres:init|postgres:start|postgres:stop");
  process.exit(1);
}

if (shouldSkipLocalPostgres) {
  console.log("DATABASE_URL does not point to localhost; skipping the built-in local Postgres helper.");
  process.exit(0);
}

const config = localPostgresConfig(parsedLocalDatabaseUrl);
const dataDir = resolve(repoRoot, ".postgres", "data");
const logFile = resolve(repoRoot, ".postgres", "postgres.log");
const pgliteDir = resolve(repoRoot, ".pglite");
const pgliteDataDir = resolve(pgliteDir, "data");
const pgliteLogFile = resolve(pgliteDir, "pglite.log");
const pglitePidFile = resolve(pgliteDir, "pglite.pid");
const dockerContainerName = process.env.AGENTGATE_POSTGRES_CONTAINER ?? envFile.AGENTGATE_POSTGRES_CONTAINER ?? "agentgate-postgres";
const dockerVolumeName = process.env.AGENTGATE_POSTGRES_VOLUME ?? envFile.AGENTGATE_POSTGRES_VOLUME ?? "agentgate-postgres-data";
const dockerImage = process.env.AGENTGATE_POSTGRES_IMAGE ?? envFile.AGENTGATE_POSTGRES_IMAGE ?? "postgres:16-alpine";
const binCache = new Map();

try {
  switch (command) {
    case "init":
      initPostgres();
      break;
    case "start":
      startPostgres();
      break;
    case "stop":
      stopPostgres();
      break;
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function initPostgres() {
  if (hasPostgresBins()) {
    initCluster();
    return;
  }

  const docker = usableDocker();
  if (docker) {
    initDockerPostgres(docker);
    return;
  }

  initPglitePostgres();
}

function startPostgres() {
  if (existsSync(dataDir)) {
    if (!hasPostgresBins()) {
      throwMissingPostgresHelper("Local Postgres data exists, but pg_ctl is not available to start it.");
    }
    startCluster();
    return;
  }

  const docker = usableDocker();
  if (docker && dockerContainerExists(docker)) {
    startDockerPostgres(docker);
    return;
  }

  startPglitePostgres();
}

function stopPostgres() {
  let handled = false;

  if (existsSync(dataDir)) {
    if (hasPostgresBins()) {
      stopCluster();
      handled = true;
    } else {
      console.log("Local Postgres data exists, but pg_ctl is not available to stop it.");
    }
  }

  const docker = findDockerExecutable();
  if (docker && dockerContainerExists(docker)) {
    stopDockerPostgres(docker);
    handled = true;
  }

  if (stopPglitePostgres()) {
    handled = true;
  }

  if (!handled) {
    console.log("No local AgentGate Postgres instance found to stop.");
  }
}

function initCluster() {
  validateConfig();
  mkdirSync(dirname(dataDir), { recursive: true });

  if (!existsSync(dataDir)) {
    const initArgs = ["-D", dataDir, "--auth=trust", "--encoding=UTF8"];
    if (process.platform !== "win32") {
      initArgs.push("--locale=C");
    }
    runPg("initdb", initArgs);
  }

  startServer();
  ensureRole();
  ensureDatabase();
  console.log(`Postgres ready on localhost:${config.port}/${config.dbName}`);
}

function startCluster() {
  if (!existsSync(dataDir)) {
    throw new Error("Local Postgres data directory is missing. Run pnpm postgres:init first.");
  }

  startServer();
  console.log(`Postgres ready on localhost:${config.port}/${config.dbName}`);
}

function stopCluster() {
  if (!existsSync(dataDir)) {
    console.log("Local Postgres data directory is missing.");
    return;
  }

  if (!isServerRunning()) {
    console.log(`Postgres already stopped for ${dataDir}`);
    return;
  }

  runPg("pg_ctl", ["-D", dataDir, "-m", "fast", "stop"]);
}

function initDockerPostgres(docker) {
  validateConfig();

  if (!dockerContainerExists(docker)) {
    runDocker(docker, [
      "run",
      "--name",
      dockerContainerName,
      "-e",
      `POSTGRES_USER=${config.dbUser}`,
      "-e",
      `POSTGRES_PASSWORD=${config.dbPassword}`,
      "-e",
      `POSTGRES_DB=${config.dbName}`,
      "-p",
      `${config.port}:5432`,
      "-v",
      `${dockerVolumeName}:/var/lib/postgresql/data`,
      "-d",
      dockerImage
    ]);
  } else if (!dockerContainerRunning(docker)) {
    runDocker(docker, ["start", dockerContainerName]);
  } else {
    console.log(`Docker Postgres already running on localhost:${config.port}/${config.dbName}`);
  }

  waitForDockerPostgres(docker);
  console.log(`Postgres ready on localhost:${config.port}/${config.dbName}`);
}

function startDockerPostgres(docker) {
  if (!dockerContainerExists(docker)) {
    initDockerPostgres(docker);
    return;
  }

  if (!dockerContainerRunning(docker)) {
    runDocker(docker, ["start", dockerContainerName]);
  } else {
    console.log(`Docker Postgres already running on localhost:${config.port}/${config.dbName}`);
  }

  waitForDockerPostgres(docker);
  console.log(`Postgres ready on localhost:${config.port}/${config.dbName}`);
}

function stopDockerPostgres(docker) {
  if (!dockerContainerRunning(docker)) {
    console.log(`Docker Postgres container ${dockerContainerName} is already stopped.`);
    return;
  }

  runDocker(docker, ["stop", dockerContainerName]);
}

function initPglitePostgres() {
  validateConfig();
  startPglitePostgres({ restart: true });
}

function startPglitePostgres(options = {}) {
  validateConfig();
  mkdirSync(pgliteDir, { recursive: true });
  writeEnvDatabaseUrl(pgliteDatabaseUrl());

  const pid = readPglitePid();
  if (pid && isProcessAlive(pid)) {
    if (options.restart) {
      stopPglitePostgres();
    } else {
      waitForTcpPort("127.0.0.1", config.port);
      console.log(`PGlite Postgres already running on localhost:${config.port}/postgres`);
      return;
    }
  }

  if (isTcpPortListening("127.0.0.1", config.port)) {
    console.log(`A service is already listening on localhost:${config.port}; using it as the local Postgres endpoint.`);
    return;
  }

  const logFd = openSync(pgliteLogFile, "a");
  const child = spawn(
    process.execPath,
    [
      resolve(repoRoot, "scripts", "pglite-postgres-server.mjs"),
      "--db",
      pgliteDataDir,
      "--host",
      "127.0.0.1",
      "--port",
      config.port,
      "--max-connections",
      "100"
    ],
    {
      cwd: repoRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env
    }
  );

  child.unref();
  closeSync(logFd);
  writeFileSync(pglitePidFile, String(child.pid), "utf8");
  waitForTcpPort("127.0.0.1", config.port);
  console.log(`PGlite Postgres ready on localhost:${config.port}/postgres`);
}

function stopPglitePostgres() {
  const pid = readPglitePid();
  if (!pid || !isProcessAlive(pid)) {
    return false;
  }

  process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessAlive(pid)) break;
    sleep(250);
  }

  if (existsSync(pglitePidFile)) {
    rmSync(pglitePidFile, { force: true });
  }
  console.log(`Stopped PGlite Postgres process ${pid}.`);
  return true;
}

function startServer() {
  if (isServerRunning()) {
    console.log(`Postgres already running on localhost:${config.port}/${config.dbName}`);
    return;
  }

  runPg("pg_ctl", ["-D", dataDir, "-l", logFile, "-o", `-p ${config.port}`, "-w", "start"]);
}

function ensureRole() {
  const roleExists = readPg("psql", [
    "-h",
    "127.0.0.1",
    "-p",
    config.port,
    "-d",
    "postgres",
    "-tAc",
    `SELECT 1 FROM pg_roles WHERE rolname=${sqlLiteral(config.dbUser)}`
  ]).trim();

  if (roleExists === "1") return;

  runPg("psql", [
    "-h",
    "127.0.0.1",
    "-p",
    config.port,
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE ROLE ${sqlIdentifier(config.dbUser)} LOGIN PASSWORD ${sqlLiteral(config.dbPassword)} CREATEDB;`
  ]);
}

function ensureDatabase() {
  const databaseExists = readPg("psql", [
    "-h",
    "127.0.0.1",
    "-p",
    config.port,
    "-d",
    "postgres",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname=${sqlLiteral(config.dbName)}`
  ]).trim();

  if (databaseExists === "1") return;

  runPg("createdb", ["-h", "127.0.0.1", "-p", config.port, "-O", config.dbUser, config.dbName]);
}

function isServerRunning() {
  if (!existsSync(dataDir)) return false;

  const result = spawnSync(requirePgBin("pg_ctl"), ["-D", dataDir, "status"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  return result.status === 0;
}

function hasPostgresBins() {
  return ["initdb", "pg_ctl", "createdb", "psql"].every((name) => Boolean(findExecutable(name)));
}

function runPg(name, args) {
  execFileSync(requirePgBin(name), args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
}

function readPg(name, args) {
  return execFileSync(requirePgBin(name), args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env
  });
}

function requirePgBin(name) {
  if (binCache.has(name)) return binCache.get(name);

  const executable = findExecutable(name);
  if (!executable) {
    throwMissingPostgresHelper(`Missing required PostgreSQL command: ${name}`);
  }

  binCache.set(name, executable);
  return executable;
}

function usableDocker() {
  const docker = findDockerExecutable();
  if (!docker) {
    return null;
  }

  const result = spawnSync(docker, ["version", "--format", "{{.Server.Version}}"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

  if (result.status !== 0) {
    return null;
  }

  return docker;
}

function throwMissingPostgresHelper(reason) {
  throw new Error(
    [
      reason,
      "Install PostgreSQL 16 CLI tools and make initdb, pg_ctl, createdb, and psql available on PATH,",
      "set POSTGRES_BIN_DIR to the PostgreSQL bin directory,",
      "start Docker Desktop for the container fallback,",
      "or put an existing database connection string in .env and run: pnpm demo:bootstrap -- --skip-postgres"
    ].join(" ")
  );
}

function findExecutable(name) {
  const directories = [
    process.env.POSTGRES_BIN_DIR,
    envFile.POSTGRES_BIN_DIR,
    ...defaultPostgresBinDirs(),
    ...(process.env.PATH ?? "").split(delimiter)
  ].filter(Boolean);

  for (const directory of directories) {
    for (const candidate of executableNames(name)) {
      const fullPath = join(directory, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  return null;
}

function executableNames(name) {
  return process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
}

function findDockerExecutable() {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const candidate of executableNames("docker")) {
      const fullPath = join(directory, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  return null;
}

function defaultPostgresBinDirs() {
  if (process.platform === "win32") {
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
    const versions = ["17", "16", "15", "14"];
    return roots.flatMap((root) => versions.map((version) => join(root, "PostgreSQL", version, "bin")));
  }

  return [
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ];
}

function dockerContainerExists(docker) {
  const result = spawnSync(docker, ["inspect", dockerContainerName], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  return result.status === 0;
}

function dockerContainerRunning(docker) {
  const result = spawnSync(docker, ["inspect", "-f", "{{.State.Running}}", dockerContainerName], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

  return result.status === 0 && result.stdout.trim() === "true";
}

function waitForDockerPostgres(docker) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync(docker, ["exec", dockerContainerName, "pg_isready", "-U", config.dbUser, "-d", config.dbName], {
      cwd: repoRoot,
      stdio: "ignore"
    });

    if (result.status === 0) return;
    sleep(1000);
  }

  throw new Error(`Docker Postgres container ${dockerContainerName} did not become ready. Check: docker logs ${dockerContainerName}`);
}

function runDocker(docker, args) {
  execFileSync(docker, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pgliteDatabaseUrl() {
  return `postgresql://postgres:postgres@127.0.0.1:${config.port}/postgres?schema=public&sslmode=disable&pgbouncer=true&connection_limit=1`;
}

function writeEnvDatabaseUrl(nextDatabaseUrl) {
  const envPath = resolve(repoRoot, ".env");
  let text = "";

  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    text = "";
  }

  const line = `DATABASE_URL="${nextDatabaseUrl}"`;
  const nextText = /^DATABASE_URL=.*$/m.test(text)
    ? text.replace(/^DATABASE_URL=.*$/m, line)
    : `${line}${text ? `\n${text}` : "\n"}`;

  if (nextText !== text) {
    writeFileSync(envPath, nextText, "utf8");
    console.log("Updated .env DATABASE_URL for embedded PGlite Postgres.");
  }
}

function readPglitePid() {
  try {
    const pid = Number(readFileSync(pglitePidFile, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isTcpPortListening(host, port) {
  return tcpProbe(host, port) === 0;
}

function waitForTcpPort(host, port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isTcpPortListening(host, port)) return;
    sleep(500);
  }

  throw new Error(`Timed out waiting for Postgres-compatible server on ${host}:${port}. Check ${pgliteLogFile}.`);
}

function tcpProbe(host, port) {
  const script = [
    "const net = require('node:net');",
    "const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });",
    "socket.setTimeout(1000);",
    "socket.on('connect', () => { socket.end(); process.exit(0); });",
    "socket.on('timeout', () => process.exit(1));",
    "socket.on('error', () => process.exit(1));"
  ].join("");

  const result = spawnSync(process.execPath, ["-e", script, host, port], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  return result.status ?? 1;
}

function localPostgresConfig(parsedUrl) {
  const parsedDatabaseName = parsedUrl?.pathname ? decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "")) : "";

  return {
    port: firstNonEmpty(process.env.POSTGRES_PORT, envFile.POSTGRES_PORT, parsedUrl?.port, "5432"),
    dbName: firstNonEmpty(process.env.POSTGRES_DB, envFile.POSTGRES_DB, parsedDatabaseName, "agentgate"),
    dbUser: firstNonEmpty(
      process.env.POSTGRES_USER,
      envFile.POSTGRES_USER,
      decodeURIComponent(parsedUrl?.username ?? ""),
      "agentgate"
    ),
    dbPassword: firstNonEmpty(
      process.env.POSTGRES_PASSWORD,
      envFile.POSTGRES_PASSWORD,
      decodeURIComponent(parsedUrl?.password ?? ""),
      "agentgate"
    )
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? "";
}

function validateConfig() {
  if (!/^\d+$/.test(config.port)) {
    throw new Error(`POSTGRES_PORT must be numeric, got ${config.port}`);
  }

  const numericPort = Number(config.port);
  if (numericPort < 1 || numericPort > 65535) {
    throw new Error(`POSTGRES_PORT must be between 1 and 65535, got ${config.port}`);
  }

  validateName(config.dbName, "database name");
  validateName(config.dbUser, "database user");
}

function validateName(value, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Unsafe Postgres ${label}: ${value}`);
  }
}

function sqlIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseLocalDatabaseUrl(value) {
  if (!value) return null;

  try {
    const parsed = new URL(value.replace(/^"|"$/g, ""));
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) return null;

    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) return null;

    return parsed;
  } catch {
    return null;
  }
}

function readEnvFile() {
  const values = {};

  try {
    const text = readFileSync(resolve(repoRoot, ".env"), "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      values[match[1]] = match[2].trim().replace(/^"|"$/g, "");
    }
  } catch {
    return values;
  }

  return values;
}
