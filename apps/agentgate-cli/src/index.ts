#!/usr/bin/env tsx
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { scanAgentSkills } from "@agentgate/skill-registry";

async function main() {
  const args = process.argv.slice(2);
  const [domain, command] = args;

  if (domain !== "skills" || command !== "scan") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const options = parseOptions(args.slice(2));
  const rootDir = resolve(options.root ?? process.cwd());
  const rootStat = await stat(rootDir).catch(() => null);

  if (!rootStat?.isDirectory()) {
    console.error(`AgentGate skill scan failed: root path is not a directory: ${rootDir}`);
    process.exitCode = 2;
    return;
  }

  const scan = await scanAgentSkills({
    rootDir,
    includeUserScopes: options.includeUserScopes
  });

  if (options.json) {
    console.log(JSON.stringify({ scan }, null, 2));
    return;
  }

  printScanSummary(scan);
}

function parseOptions(args: string[]) {
  const options: {
    root?: string | undefined;
    includeUserScopes: boolean;
    json: boolean;
  } = {
    includeUserScopes: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      options.root = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--include-user-scopes") {
      options.includeUserScopes = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printScanSummary(scan: Awaited<ReturnType<typeof scanAgentSkills>>) {
  console.log("AgentGate skill scan");
  console.log(`Root: ${scan.rootDir}`);
  console.log(`Candidates: ${scan.summary.total}`);
  console.log(`Warnings: ${scan.summary.warningCount}`);
  console.log("");
  console.log("By source:");
  for (const [source, count] of Object.entries(scan.summary.bySourceType)) {
    console.log(`  ${source}: ${count}`);
  }
  console.log("By risk:");
  for (const [risk, count] of Object.entries(scan.summary.byRiskLevel)) {
    console.log(`  ${risk}: ${count}`);
  }

  if (scan.duplicateGroups.length > 0) {
    console.log("");
    console.log("Duplicate display names:");
    for (const group of scan.duplicateGroups) {
      console.log(`  ${group.normalizedName}: ${group.candidates.map((candidate) => candidate.skillId).join(", ")}`);
    }
  }

  const warningRows = scan.candidates.flatMap((candidate) =>
    candidate.warnings.map((warning) => `${candidate.skillId}: ${warning}`)
  );
  if (scan.warnings.length > 0 || warningRows.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of [...scan.warnings, ...warningRows]) {
      console.log(`  - ${warning}`);
    }
  }
}

function printUsage() {
  console.log(`Usage:
  agentgate skills scan --root <path> [--include-user-scopes] [--json]

Examples:
  pnpm agentgate skills scan --root .
  pnpm agentgate skills scan --root /path/to/downloaded/skills --json
  pnpm exec agentgate skills scan --root . --include-user-scopes`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
