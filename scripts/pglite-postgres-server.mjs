#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const options = parseArgs(process.argv.slice(2));
mkdirSync(dirname(options.db), { recursive: true });

const db = new PGlite(options.db);
await db.waitReady;

const server = new PGLiteSocketServer({
  db,
  host: options.host,
  port: options.port,
  maxConnections: options.maxConnections
});

server.addEventListener("listening", () => {
  console.log(`PGlite Postgres listening on ${options.host}:${options.port}`);
});

server.addEventListener("error", (event) => {
  console.error("PGlite Postgres socket error:", event.detail);
});

await server.start();

async function shutdown() {
  await server.stop();
  await db.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});

function parseArgs(args) {
  const values = {
    db: ".pglite/data",
    host: "127.0.0.1",
    port: "5432",
    maxConnections: "20"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--db") {
      values.db = args[index + 1];
      index += 1;
    } else if (arg === "--host") {
      values.host = args[index + 1];
      index += 1;
    } else if (arg === "--port") {
      values.port = args[index + 1];
      index += 1;
    } else if (arg === "--max-connections") {
      values.maxConnections = args[index + 1];
      index += 1;
    } else {
      console.error(`Unknown PGlite server option: ${arg}`);
      process.exit(1);
    }
  }

  if (!/^\d+$/.test(values.port)) {
    console.error(`Invalid PGlite port: ${values.port}`);
    process.exit(1);
  }

  return {
    db: resolve(values.db),
    host: values.host,
    port: Number(values.port),
    maxConnections: Number(values.maxConnections)
  };
}
