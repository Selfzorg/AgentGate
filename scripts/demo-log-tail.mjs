#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const logPath = resolve("ecommerce_operations.log");
const count = Number(process.argv[2] ?? "5");

if (!existsSync(logPath)) {
  console.log("ecommerce_operations.log does not exist yet.");
  process.exit(0);
}

const lines = readFileSync(logPath, "utf8").trimEnd().split(/\r?\n/);
console.log(lines.slice(-count).join("\n"));
