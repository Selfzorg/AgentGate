#!/usr/bin/env tsx
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { scanAgentSkills } from "@agentgate/skill-registry";

async function main() {
  const args = process.argv.slice(2);
  const [domain, command] = args;

  if (domain === "skills" && command === "scan") {
    await runSkillScan(args.slice(2));
    return;
  }

  if (domain === "claude" && command === "continue") {
    await runClaudeContinue(args.slice(2));
    return;
  }

  printUsage();
  process.exitCode = 1;
}

async function runSkillScan(args: string[]) {
  const options = parseSkillScanOptions(args);
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

async function runClaudeContinue(args: string[]) {
  const options = parseClaudeContinueOptions(args);
  const apiBaseUrl = options.apiBaseUrl ?? process.env.AGENTGATE_API_BASE_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${encodeURIComponent(options.runId)}/claude-handoff/continue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      execution_token: options.token,
      idempotency_key: options.idempotencyKey,
      requested_by: "claude-code"
    })
  });
  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    console.error(JSON.stringify(body, null, 2));
    process.exitCode = response.status >= 500 ? 1 : 2;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const handoff = isRecord(body.claude_handoff) ? body.claude_handoff : {};
  const packet = isRecord(body.execution_packet) ? body.execution_packet : {};
  const skill = isRecord(packet.skill) ? packet.skill : {};
  const approvedAction = isRecord(packet.approved_action) ? packet.approved_action : {};
  const safety = isRecord(packet.safety) ? packet.safety : {};

  console.log("AgentGate Claude execution packet verified");
  console.log(`Run: ${options.runId}`);
  console.log(`Status: ${String(handoff.status ?? packet.status ?? "unknown")}`);
  console.log(`Skill: ${String(skill.name ?? skill.skill_id ?? "unknown")}`);
  console.log(`Skill ID: ${String(skill.skill_id ?? "unknown")}`);
  console.log(`Skill version: ${String(skill.version ?? "unknown")}`);
  console.log(`Approved hash: ${String(skill.approved_hash ?? skill.source_hash ?? "unknown")}`);
  console.log(`Entrypoint hash: ${String(skill.entrypoint_content_hash ?? "unknown")}`);
  console.log(`Token status: ${String(safety.token_status ?? "unknown")}`);
  if (typeof handoff.logs_url === "string") console.log(`Logs: ${apiBaseUrl}${handoff.logs_url}`);
  console.log("");
  console.log("Claude Code instructions:");
  for (const instruction of Array.isArray(packet.instructions) ? packet.instructions : []) {
    if (typeof instruction === "string") console.log(`- ${instruction}`);
  }
  console.log("");
  console.log("Approved raw action:");
  console.log(String(approvedAction.raw_action ?? ""));
  console.log("");
  console.log("Approved context:");
  console.log(JSON.stringify(approvedAction.context ?? {}, null, 2));
  console.log("");
  console.log("Approved skill body to execute:");
  console.log("```markdown");
  console.log(String(skill.body ?? ""));
  console.log("```");
  const supportingFiles = Array.isArray(skill.supporting_files) ? skill.supporting_files : [];
  if (supportingFiles.length > 0) {
    console.log("");
    console.log("Approved supporting files:");
    for (const file of supportingFiles) {
      if (!isRecord(file)) continue;
      console.log(`--- ${String(file.path ?? "supporting-file")} ---`);
      console.log(String(file.content ?? ""));
    }
  }
  console.log("");
  console.log("Execute the approved skill body now. Do not run a different skill or target.");
}

function parseSkillScanOptions(args: string[]) {
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
      options.root = requireOptionValue(args, index, arg);
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

function parseClaudeContinueOptions(args: string[]) {
  const options: {
    runId?: string | undefined;
    token?: string | undefined;
    idempotencyKey?: string | undefined;
    apiBaseUrl?: string | undefined;
    json: boolean;
  } = {
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run-id") {
      options.runId = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--token") {
      options.token = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--idempotency-key") {
      options.idempotencyKey = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--api-base-url") {
      options.apiBaseUrl = requireOptionValue(args, index, arg);
      index += 1;
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

  if (!options.runId) throw new Error("--run-id is required");
  if (!options.token) throw new Error("--token is required");
  return {
    ...options,
    runId: options.runId,
    token: options.token,
    idempotencyKey: options.idempotencyKey ?? `claude-handoff-${options.runId}`
  };
}

function requireOptionValue(args: string[], index: number, option: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  agentgate claude continue --run-id <run-id> --token <token> [--api-base-url <url>] [--json]

Examples:
  pnpm agentgate skills scan --root .
  pnpm agentgate skills scan --root /path/to/downloaded/skills --json
  pnpm exec agentgate skills scan --root . --include-user-scopes
  AGENTGATE_API_BASE_URL=http://localhost:4000 pnpm exec agentgate claude continue --run-id run_123 --token agt_xxx`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
