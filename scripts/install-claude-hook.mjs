#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const globalInstall = args.has("--global");
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const targetArgIndex = process.argv.findIndex((arg) => arg === "--target");
const target =
  targetArgIndex >= 0
    ? resolve(process.argv[targetArgIndex + 1] ?? "")
    : globalInstall
      ? join(homedir(), ".claude", "settings.json")
      : join(repoRoot, ".claude", "settings.json");

const examplePath = join(repoRoot, ".claude", "settings.example.json");
const preToolUseHookEntry = {
  matcher: "Bash|Edit|Write|mcp__.*",
  hooks: [
    {
      type: "command",
      command: "node .agentgate/hooks/claude-pretooluse.mjs"
    }
  ]
};
const sessionStartHookEntry = {
  matcher: "startup|resume|clear|compact",
  hooks: [
    {
      type: "command",
      command: "node",
      args: [".agentgate/hooks/claude-sessionstart-evidence-worker.mjs"],
      statusMessage: "Starting AgentGate evidence worker"
    }
  ]
};

async function main() {
  if (!existsSync(examplePath)) {
    throw new Error(`Missing Claude hook example at ${examplePath}`);
  }

  if (!existsSync(target)) {
    await reportOrRun(`create ${target}`, async () => {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(examplePath, target);
    });
    console.log(`Installed AgentGate Claude hook settings at ${target}`);
    return;
  }

  const existingText = await readFile(target, "utf8");
  const backupPath = `${target}.agentgate-backup-${timestamp()}`;
  let settings;
  try {
    settings = JSON.parse(existingText);
  } catch {
    if (!force) {
      throw new Error(`Refusing to edit invalid JSON at ${target}. Re-run with --force to replace it after backup.`);
    }
    settings = {};
  }

  const next = mergeHook(settings);
  if (JSON.stringify(settings) === JSON.stringify(next)) {
    console.log(`AgentGate Claude hook is already installed in ${target}`);
    return;
  }

  await reportOrRun(`backup ${target} to ${backupPath}`, async () => {
    await rename(target, backupPath);
  });
  await reportOrRun(`write merged settings to ${target}`, async () => {
    await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  });
  console.log(`Installed AgentGate Claude hook settings at ${target}`);
  console.log(`Backup written to ${backupPath}`);
}

function mergeHook(settings) {
  const next = structuredClone(settings && typeof settings === "object" ? settings : {});
  next.hooks = next.hooks && typeof next.hooks === "object" ? next.hooks : {};
  next.hooks.PreToolUse = Array.isArray(next.hooks.PreToolUse) ? next.hooks.PreToolUse : [];
  next.hooks.SessionStart = Array.isArray(next.hooks.SessionStart) ? next.hooks.SessionStart : [];

  const preToolUseAlreadyInstalled = next.hooks.PreToolUse.some((entry) =>
    JSON.stringify(entry).includes(".agentgate/hooks/claude-pretooluse.mjs")
  );
  if (!preToolUseAlreadyInstalled) next.hooks.PreToolUse.push(preToolUseHookEntry);

  const sessionStartAlreadyInstalled = next.hooks.SessionStart.some((entry) =>
    JSON.stringify(entry).includes(".agentgate/hooks/claude-sessionstart-evidence-worker.mjs")
  );
  if (!sessionStartAlreadyInstalled) next.hooks.SessionStart.push(sessionStartHookEntry);

  return next;
}

async function reportOrRun(label, fn) {
  if (dryRun) {
    console.log(`[dry-run] ${label}`);
    return;
  }
  await fn();
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
