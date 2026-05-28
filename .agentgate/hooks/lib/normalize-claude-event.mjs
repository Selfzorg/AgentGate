import { basename } from "node:path";
import { redactValue, safeJsonStringify } from "./redact.mjs";
import { classifyActionSafety } from "./safety-classifier.mjs";

const SUPPORTED_TOOLS = new Set(["Bash", "Edit", "Write"]);

export function normalizeClaudeEvent(event, env = process.env) {
  const hookEventName = stringFrom(
    event?.hook_event_name,
    event?.hookEventName,
    event?.event,
    event?.hook?.name,
    "PreToolUse"
  );
  const toolName = stringFrom(
    event?.tool_name,
    event?.toolName,
    event?.tool?.name,
    event?.name,
    event?.tool,
    ""
  );
  const toolInput = objectFrom(event?.tool_input ?? event?.toolInput ?? event?.input ?? event?.tool?.input ?? event?.arguments);
  const normalizedToolName = normalizeMcpToolName(toolName);
  const supported =
    hookEventName === "PreToolUse" && (SUPPORTED_TOOLS.has(toolName) || toolName.startsWith("mcp__"));

  const redactedToolInput = redactValue(toolInput);
  const rawAction = rawActionForTool(toolName, normalizedToolName, redactedToolInput, event);
  const context = inferContext({ event, env, toolInput: redactedToolInput, rawAction });
  const normalizedRequest = {
    tenant_id: stringFrom(env.AGENTGATE_TENANT_ID, event?.tenant_id, event?.tenantId, "tenant_demo"),
    workspace_id: stringFrom(env.AGENTGATE_WORKSPACE_ID, event?.workspace_id, event?.workspaceId, "workspace_demo"),
    source: "claude-code",
    adapter_type: "hook",
    agent: {
      agent_id: stringFrom(env.AGENTGATE_AGENT_ID, event?.agent?.agent_id, event?.agent?.id, "agent_code_001"),
      agent_type: stringFrom(env.AGENTGATE_AGENT_TYPE, event?.agent?.agent_type, event?.agent?.type, "coding_agent"),
      role: stringFrom(env.AGENTGATE_AGENT_ROLE, event?.agent?.role, "code_agent")
    },
    tool: {
      tool_name: normalizedToolName || toolName || "unknown",
      ...(event?.tool_call_id || event?.toolCallId ? { tool_call_id: stringFrom(event.tool_call_id, event.toolCallId) } : {})
    },
    raw_action: rawAction || normalizedToolName || toolName || "unknown",
    context,
    requested_at: new Date().toISOString()
  };
  const safety = classifyActionSafety({
    toolName,
    rawAction: normalizedRequest.raw_action
  });

  return {
    hookEventName,
    toolName,
    normalizedToolName,
    toolInput: redactedToolInput,
    supported,
    delegatesToAgentGateMcp: isAgentGateMcpTool(normalizedToolName),
    normalizedRequest,
    safety
  };
}

export function normalizeMcpToolName(toolName) {
  const name = String(toolName ?? "");
  if (!name.startsWith("mcp__")) return name;

  const parts = name.split("__").filter(Boolean);
  if (parts.length < 2) return name.replaceAll("__", ".");
  const [, server, ...toolParts] = parts;
  return `mcp.${server}.${toolParts.join("_")}`;
}

export function isAgentGateMcpTool(toolName) {
  return String(toolName ?? "").startsWith("mcp.agentgate.agentgate_");
}

function rawActionForTool(toolName, normalizedToolName, toolInput, event) {
  if (toolName === "Bash") {
    return stringFrom(toolInput.command, toolInput.cmd, event?.command, "");
  }

  if (toolName === "Edit") {
    const filePath = stringFrom(toolInput.file_path, toolInput.path, event?.file_path, "unknown");
    return `Edit ${filePath}`;
  }

  if (toolName === "Write") {
    const filePath = stringFrom(toolInput.file_path, toolInput.path, event?.file_path, "unknown");
    return `Write ${filePath}`;
  }

  if (String(toolName).startsWith("mcp__")) {
    return `${normalizedToolName}(${safeJsonStringify(toolInput ?? {})})`;
  }

  return stringFrom(event?.raw_action, normalizedToolName, toolName, "");
}

function inferContext({ event, env, toolInput, rawAction }) {
  const providedContext = objectFrom(event?.context ?? toolInput.context);
  const action = String(rawAction ?? "");
  const lower = action.toLowerCase();
  const cwd = stringFrom(event?.cwd, toolInput.cwd, env.AGENTGATE_CWD, env.PWD, process.cwd());
  const environment = normalizeEnvironment(
    providedContext.environment ??
      toolInput.environment ??
      env.AGENTGATE_ENVIRONMENT ??
      (/\bprod(?:uction)?\b|--prod\b|migrate:prod/i.test(action) ? "production" : lower.includes("staging") ? "staging" : "dev")
  );

  const context = compactObject({
    repo: stringFrom(providedContext.repo, toolInput.repo, env.AGENTGATE_REPO, cwd ? basename(cwd) : "agentgate"),
    branch: stringFrom(providedContext.branch, toolInput.branch, env.AGENTGATE_BRANCH),
    cwd,
    environment,
    service: stringFrom(providedContext.service, toolInput.service, env.AGENTGATE_SERVICE),
    database: stringFrom(
      providedContext.database,
      toolInput.database,
      env.AGENTGATE_DATABASE,
      /migrate|postgres|drop_table|drop table/i.test(action) ? "prod-main" : undefined
    ),
    target_branch: stringFrom(
      providedContext.target_branch,
      providedContext.targetBranch,
      toolInput.target_branch,
      toolInput.targetBranch,
      /main\b/i.test(action) ? "main" : undefined
    ),
    ci_status: normalizeStatus(providedContext.ci_status ?? providedContext.ciStatus ?? toolInput.ci_status ?? toolInput.ciStatus),
    tests_status: normalizeStatus(
      providedContext.tests_status ?? providedContext.testsStatus ?? toolInput.tests_status ?? toolInput.testsStatus
    ),
    security_scan: normalizeStatus(
      providedContext.security_scan ?? providedContext.securityScan ?? toolInput.security_scan ?? toolInput.securityScan
    ),
    rollback_plan: normalizeRollback(
      providedContext.rollback_plan ?? providedContext.rollbackPlan ?? toolInput.rollback_plan ?? toolInput.rollbackPlan
    ),
    staging_deploy: normalizeStaging(
      providedContext.staging_deploy ?? providedContext.stagingDeploy ?? toolInput.staging_deploy ?? toolInput.stagingDeploy
    ),
    dry_run_completed: booleanFrom(
      providedContext.dry_run_completed ??
        providedContext.dryRunCompleted ??
        toolInput.dry_run_completed ??
        toolInput.dryRunCompleted ??
        (/migrate:prod|apply_migration|alembic upgrade/i.test(action) && environment === "production" ? false : undefined)
    ),
    schema_diff_generated: booleanFrom(
      providedContext.schema_diff_generated ??
        providedContext.schemaDiffGenerated ??
        toolInput.schema_diff_generated ??
        toolInput.schemaDiffGenerated
    ),
    backup_exists: booleanFrom(
      providedContext.backup_exists ?? providedContext.backupExists ?? toolInput.backup_exists ?? toolInput.backupExists
    ),
    required_reviews_passed: booleanFrom(
      providedContext.required_reviews_passed ??
        providedContext.requiredReviewsPassed ??
        toolInput.required_reviews_passed ??
        toolInput.requiredReviewsPassed
    ),
    branch_protection_satisfied: booleanFrom(
      providedContext.branch_protection_satisfied ??
        providedContext.branchProtectionSatisfied ??
        toolInput.branch_protection_satisfied ??
        toolInput.branchProtectionSatisfied
    )
  });

  return context;
}

function objectFrom(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringFrom(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function normalizeEnvironment(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "prod" || normalized === "production") return "production";
  if (normalized === "staging" || normalized === "stage") return "staging";
  return "dev";
}

function normalizeStatus(value) {
  if (value === "passed" || value === "failed" || value === "unknown") return value;
  if (value === true) return "passed";
  if (value === false) return "failed";
  return undefined;
}

function normalizeRollback(value) {
  if (value === "exists" || value === "missing" || value === "unknown") return value;
  if (value === true) return "exists";
  if (value === false) return "missing";
  return undefined;
}

function normalizeStaging(value) {
  if (value === "success" || value === "failed" || value === "unknown") return value;
  if (value === true) return "success";
  if (value === false) return "failed";
  return undefined;
}

function booleanFrom(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""));
}
