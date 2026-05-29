#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultExamplePath = join(repoRoot, ".codex", "hooks.example.json");

export const codexPreToolUseHookEntry = {
  matcher: "Bash|Shell|shell|exec_command|apply_patch|ApplyPatch|Edit|Write|mcp__.*|mcp.*",
  hooks: [
    {
      type: "command",
      command: "node .agentgate/hooks/codex-pretooluse.mjs"
    }
  ]
};

export async function installCodexHook(options = {}) {
  const target = options.target ?? join(repoRoot, ".codex", "hooks.json");
  const examplePath = options.examplePath ?? defaultExamplePath;
  const dryRun = options.dryRun === true;
  const force = options.force === true;

  if (!existsSync(examplePath)) {
    throw new Error(`Missing Codex hook example at ${examplePath}`);
  }

  if (!existsSync(target)) {
    await reportOrRun(`create ${target}`, dryRun, async () => {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(examplePath, target);
    });
    return { target, changed: true, created: true, dryRun };
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

  const next = mergeCodexHook(settings);
  if (JSON.stringify(settings) === JSON.stringify(next)) {
    return { target, changed: false, created: false, dryRun };
  }

  await reportOrRun(`backup ${target} to ${backupPath}`, dryRun, async () => {
    await rename(target, backupPath);
  });
  await reportOrRun(`write merged settings to ${target}`, dryRun, async () => {
    await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  });

  return { target, backupPath, changed: true, created: false, dryRun };
}

export function mergeCodexHook(settings) {
  const next = structuredClone(settings && typeof settings === "object" ? settings : {});
  next.hooks = next.hooks && typeof next.hooks === "object" ? next.hooks : {};
  next.hooks.PreToolUse = Array.isArray(next.hooks.PreToolUse) ? next.hooks.PreToolUse : [];

  const alreadyInstalled = next.hooks.PreToolUse.some((entry) =>
    JSON.stringify(entry).includes(".agentgate/hooks/codex-pretooluse.mjs")
  );
  if (!alreadyInstalled) next.hooks.PreToolUse.push(codexPreToolUseHookEntry);

  return next;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await installCodexHook(options);

  if (result.dryRun) {
    console.log(`[dry-run] AgentGate Codex hook would be installed at ${result.target}`);
    return;
  }

  if (!result.changed) {
    console.log(`AgentGate Codex hook is already installed in ${result.target}`);
    return;
  }

  console.log(`Installed AgentGate Codex hook settings at ${result.target}`);
  if (result.backupPath) console.log(`Backup written to ${result.backupPath}`);
}

function parseArgs(argv) {
  const args = new Set(argv);
  const targetArgIndex = argv.findIndex((arg) => arg === "--target");
  const target =
    targetArgIndex >= 0
      ? resolve(argv[targetArgIndex + 1] ?? "")
      : args.has("--global")
        ? join(homedir(), ".codex", "hooks.json")
        : join(repoRoot, ".codex", "hooks.json");

  return {
    target,
    dryRun: args.has("--dry-run"),
    force: args.has("--force")
  };
}

async function reportOrRun(label, dryRun, fn) {
  if (dryRun) {
    console.log(`[dry-run] ${label}`);
    return;
  }
  await fn();
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? fileURLToPath(import.meta.url)).href) {
  installMain().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

async function installMain() {
  await main();
}
