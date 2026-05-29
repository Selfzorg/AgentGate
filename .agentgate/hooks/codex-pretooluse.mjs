#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { postDecision } from "./lib/agentgate-client.mjs";
import { normalizeCodexEvent } from "./lib/normalize-codex-event.mjs";
import { redactValue, safeJsonStringify } from "./lib/redact.mjs";

export async function runHookEvent(event, env = process.env, options = {}) {
  const normalized = normalizeCodexEvent(event, env);

  if (!normalized.supported) {
    const output = allowOutput("AgentGate ignored unsupported Codex hook event.", {
      decision: "ALLOW",
      mode: "observe",
      supported: false
    });
    await maybeWriteDebugLog({ event, normalized, output }, env, options);
    return output;
  }

  if (normalized.delegatesToAgentGateMcp) {
    const output = allowOutput("AgentGate MCP proxy will govern this tool call.", {
      decision: "ALLOW",
      mode: "observe",
      delegated_to: "agentgate_mcp_proxy",
      tool_name: normalized.normalizedToolName
    });
    await maybeWriteDebugLog({ event, normalized, output }, env, options);
    return output;
  }

  try {
    const decision = await postDecision(normalized.normalizedRequest, env, options);
    const output = outputForDecision(decision);
    await maybeWriteDebugLog({ event, normalized, decision, output }, env, options);
    return output;
  } catch (error) {
    const failMode = String(env.AGENTGATE_HOOK_FAIL_MODE ?? "closed").toLowerCase();
    const mayFailOpen = failMode === "open" && normalized.safety.isClearlySafe;
    const output = mayFailOpen
      ? allowOutput("AgentGate API unavailable; clearly safe command allowed in observe fail-open mode.", {
          decision: "ALLOW",
          mode: "observe",
          offline: true,
          fail_mode: "open",
          reason: normalized.safety.reason
        })
      : denyOutput(
          `AgentGate API unavailable; tool call blocked (${normalized.safety.reason})`,
          {
            decision: "DENY",
            mode: "enforce",
            offline: true,
            fail_mode: failMode,
            reason: error.message
          }
        );
    await maybeWriteDebugLog({ event, normalized, error: error.message, output }, env, options);
    return output;
  }
}

export function outputForDecision(decision) {
  const agentgate = compactObject({
    decision: decision.decision,
    skill_id: decision.skill_id,
    risk_level: decision.risk_level,
    risk_score: decision.risk_score,
    run_id: decision.run_id,
    trace_id: decision.trace_id,
    reason: decision.reason,
    missing_checks: decision.missing_checks,
    dry_run_required: decision.dry_run_required,
    mode: decision.mode
  });

  if (decision.decision === "ALLOW") {
    return allowOutput(decision.reason ?? "AgentGate allowed this tool call.", agentgate);
  }

  if (decision.decision === "REQUIRE_APPROVAL") {
    return denyOutput(
      `AgentGate requires approval before this tool call. Run ${decision.run_id}; trace ${decision.trace_id}. ${decision.reason}`,
      agentgate
    );
  }

  if (decision.decision === "FORCE_DRY_RUN") {
    return denyOutput(
      `AgentGate requires a dry-run before live execution. Run ${decision.run_id}; trace ${decision.trace_id}. ${decision.reason}`,
      agentgate
    );
  }

  return denyOutput(`AgentGate denied this tool call. ${decision.reason}`, agentgate);
}

function allowOutput(reason, agentgate) {
  return codexOutput("allow", reason, agentgate);
}

function denyOutput(reason, agentgate) {
  return codexOutput("deny", reason, agentgate);
}

function codexOutput(permissionDecision, reason, agentgate) {
  const permissionDecisionReason = redactString(reason);
  const output = {
    continue: true,
    decision: permissionDecision,
    reason: permissionDecisionReason,
    permissionDecision,
    permissionDecisionReason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason
    },
    agentgate: redactValue(agentgate)
  };
  return redactValue(output);
}

async function maybeWriteDebugLog(entry, env, options) {
  if (options.writeDebugLog === false) return;
  if (!truthy(env.AGENTGATE_HOOK_DEBUG)) return;

  const projectRoot = env.AGENTGATE_PROJECT_ROOT ?? process.cwd();
  const logPath =
    env.AGENTGATE_CODEX_HOOK_LOG_PATH ??
    env.AGENTGATE_HOOK_LOG_PATH ??
    join(projectRoot, ".agentgate", "logs", "codex-hook-events.jsonl");
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(
    logPath,
    `${safeJsonStringify({
      timestamp: new Date().toISOString(),
      ...entry
    })}\n`,
    "utf8"
  );
}

async function main() {
  try {
    const input = await readStdin();
    const event = input.trim().length > 0 ? JSON.parse(input) : {};
    const output = await runHookEvent(event);
    process.stdout.write(`${safeJsonStringify(output)}\n`);
  } catch (error) {
    const output = denyOutput(`AgentGate hook failed closed: ${error.message}`, {
      decision: "DENY",
      mode: "enforce",
      reason: error.message
    });
    process.stdout.write(`${safeJsonStringify(output)}\n`);
    process.exitCode = 0;
  }
}

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function redactString(value) {
  return String(redactValue(String(value)));
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? fileURLToPath(import.meta.url)).href) {
  await main();
}
