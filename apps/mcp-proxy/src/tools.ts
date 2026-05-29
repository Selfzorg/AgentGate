import { z } from "zod";
import {
  type AgentGateAgent,
  type AgentGateDecision,
  type AgentGateMcpConfig,
  claimEvidenceTask,
  configFromEnv,
  executeRun,
  failEvidenceTask,
  getAuditTrace,
  getEvidenceTask,
  getRun,
  issueExecutionToken,
  invokeMcpTool,
  listEvidenceTasks,
  replayDemoAction,
  submitEvidenceTaskResult
} from "./agentgate-client.js";
import { redactedJson, redactValue } from "./redact.js";

export const AGENTGATE_TOOL_NAMES = [
  "agentgate_run_tests",
  "agentgate_create_pr",
  "agentgate_merge_pr",
  "agentgate_apply_migration",
  "agentgate_drop_table",
  "agentgate_deploy_staging",
  "agentgate_deploy_production",
  "agentgate_replay_demo_action",
  "agentgate_get_run",
  "agentgate_get_audit_trace",
  "agentgate_execute_approved_run",
  "agentgate_list_evidence_tasks",
  "agentgate_claim_evidence_task",
  "agentgate_get_evidence_task",
  "agentgate_submit_evidence_result",
  "agentgate_fail_evidence_task"
] as const;

export type AgentGateToolName = (typeof AGENTGATE_TOOL_NAMES)[number];

export type AgentGateToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type AgentGateToolDefinition = {
  name: AgentGateToolName;
  description: string;
  inputSchema: z.ZodRawShape;
};

export const AGENTGATE_TOOL_DEFINITIONS: AgentGateToolDefinition[] = [
  {
    name: "agentgate_run_tests",
    description: "Ask AgentGate to govern a local test command without executing it.",
    inputSchema: {
      command: z.string().default("pnpm test"),
      repo: z.string().optional(),
      branch: z.string().optional()
    }
  },
  {
    name: "agentgate_create_pr",
    description: "Ask AgentGate to govern pull request creation without calling GitHub.",
    inputSchema: {
      title: z.string().optional(),
      branch: z.string().optional(),
      target_branch: z.string().default("main")
    }
  },
  {
    name: "agentgate_merge_pr",
    description: "Ask AgentGate to govern a pull request merge without calling GitHub.",
    inputSchema: {
      pr_number: z.number().int().positive().optional(),
      target_branch: z.string().default("main"),
      ci_status: z.enum(["passed", "failed", "unknown"]).optional(),
      required_reviews_passed: z.boolean().optional(),
      branch_protection_satisfied: z.boolean().optional()
    }
  },
  {
    name: "agentgate_apply_migration",
    description: "Ask AgentGate to govern a database migration without touching the database.",
    inputSchema: {
      migration_name: z.string().optional(),
      database: z.string().default("prod-main"),
      environment: z.enum(["dev", "staging", "production"]).default("production"),
      dry_run_completed: z.boolean().default(false),
      schema_diff_generated: z.boolean().optional(),
      backup_exists: z.boolean().optional()
    }
  },
  {
    name: "agentgate_drop_table",
    description: "Ask AgentGate to govern a destructive table drop without touching the database.",
    inputSchema: {
      table: z.string().default("users"),
      database: z.string().default("prod-main"),
      environment: z.enum(["dev", "staging", "production"]).default("production")
    }
  },
  {
    name: "agentgate_deploy_staging",
    description: "Ask AgentGate to govern a staging deployment without calling the deployment provider.",
    inputSchema: {
      service: z.string().default("checkout-api"),
      branch: z.string().optional()
    }
  },
  {
    name: "agentgate_deploy_production",
    description:
      "Ask AgentGate to govern a production deployment without calling the deployment provider. If the user named a local Claude/Codex skill or slash command, include it in requested_skill or user_intent so AgentGate can resolve the imported skill registry entry.",
    inputSchema: {
      service: z.string().default("checkout-api"),
      requested_skill: z.string().optional(),
      user_intent: z.string().optional()
    }
  },
  {
    name: "agentgate_replay_demo_action",
    description: "Replay a PRD demo fixture through AgentGate governance.",
    inputSchema: {
      action_id: z.string().default("safe_tests")
    }
  },
  {
    name: "agentgate_get_run",
    description: "Read a governed AgentGate run by ID.",
    inputSchema: {
      run_id: z.string()
    }
  },
  {
    name: "agentgate_get_audit_trace",
    description: "Read AgentGate audit events and integrity for a trace ID.",
    inputSchema: {
      trace_id: z.string()
    }
  },
  {
    name: "agentgate_execute_approved_run",
    description:
      "Issue a scoped execution token and queue an already-approved AgentGate run without real external side effects. Imported Claude skills must use the agentgate claude continue/complete commands instead.",
    inputSchema: {
      run_id: z.string(),
      approval_id: z.string().optional(),
      idempotency_key: z.string().optional()
    }
  },
  {
    name: "agentgate_list_evidence_tasks",
    description: "List queued or stale AgentGate evidence tasks for an external agent worker.",
    inputSchema: {
      skill_run_id: z.string().optional(),
      limit: z.number().int().positive().max(50).optional(),
      newest_first: z.boolean().optional()
    }
  },
  {
    name: "agentgate_claim_evidence_task",
    description: "Claim a queued AgentGate evidence task with a lease.",
    inputSchema: {
      task_id: z.string(),
      agent_id: z.string().default("claude_code_agent"),
      runtime: z.string().default("claude_code_mcp"),
      lease_seconds: z.number().int().positive().max(900).default(120)
    }
  },
  {
    name: "agentgate_get_evidence_task",
    description: "Read a specific AgentGate evidence task.",
    inputSchema: {
      task_id: z.string()
    }
  },
  {
    name: "agentgate_submit_evidence_result",
    description: "Submit a read-only evidence result for a claimed AgentGate task.",
    inputSchema: {
      task_id: z.string(),
      agent_id: z.string().default("claude_code_agent"),
      status: z.enum(["passed", "failed", "missing"]),
      reason: z.string(),
      evidence: z.record(z.unknown()).optional()
    }
  },
  {
    name: "agentgate_fail_evidence_task",
    description: "Mark a claimed AgentGate evidence task as failed with a reason.",
    inputSchema: {
      task_id: z.string(),
      agent_id: z.string().default("claude_code_agent"),
      reason: z.string(),
      error: z.record(z.unknown()).optional()
    }
  }
];

export function listAgentGateTools(): AgentGateToolDefinition[] {
  return AGENTGATE_TOOL_DEFINITIONS;
}

export async function callAgentGateTool(
  name: string,
  args: Record<string, unknown> = {},
  config: AgentGateMcpConfig = configFromEnv()
): Promise<AgentGateToolResult> {
  try {
    switch (name) {
      case "agentgate_run_tests":
        return decisionResult(
          await invokeMcpTool(
            {
              toolName: stringArg(args.command, "pnpm test"),
              arguments: args,
              context: baseContext(args, "dev"),
              agent: agentFor("code_agent")
            },
            config
          )
        );

      case "agentgate_create_pr":
        return decisionResult(
          await invokeMcpTool(
            {
              toolName: "gh pr create",
              arguments: args,
              context: {
                ...baseContext(args, "dev"),
                target_branch: stringArg(args.target_branch, "main")
              },
              agent: agentFor("code_agent")
            },
            config
          )
        );

      case "agentgate_merge_pr":
        return decisionResult(
          await invokeMcpTool(
            {
              toolName: "mcp.github.merge_pr",
              arguments: args,
              context: compactObject({
                ...baseContext(args, "dev"),
                target_branch: stringArg(args.target_branch, "main"),
                ci_status: args.ci_status,
                required_reviews_passed: args.required_reviews_passed,
                branch_protection_satisfied: args.branch_protection_satisfied
              }),
              agent: agentFor("code_agent")
            },
            config
          )
        );

      case "agentgate_apply_migration":
        return decisionResult(
          await invokeMcpTool(
            {
              toolName: "mcp.postgres.apply_migration",
              arguments: args,
              context: compactObject({
                ...baseContext(args, environmentArg(args.environment, "production")),
                database: stringArg(args.database, "prod-main"),
                dry_run_completed: booleanArg(args.dry_run_completed, false),
                schema_diff_generated: args.schema_diff_generated,
                backup_exists: args.backup_exists
              }),
              agent: agentFor("db_agent")
            },
            config
          )
        );

      case "agentgate_drop_table":
        return decisionResult(
          await invokeMcpTool(
            {
              toolName: "mcp.postgres.drop_table",
              arguments: args,
              context: {
                ...baseContext(args, environmentArg(args.environment, "production")),
                database: stringArg(args.database, "prod-main")
              },
              agent: agentFor("db_agent")
            },
            config
          )
        );

      case "agentgate_deploy_staging":
        return decisionResult(
          await invokeMcpTool(
            {
              toolName: "npm run deploy:staging",
              arguments: args,
              context: {
                ...baseContext(args, "staging"),
                service: stringArg(args.service, "checkout-api")
              },
              agent: agentFor("code_agent")
            },
            config
          )
        );

      case "agentgate_deploy_production":
        return decisionResult(
          await invokeMcpTool(
            {
              toolName: "vercel deploy --prod",
              arguments: args,
              context: compactObject({
                ...baseContext(args, "production"),
                service: stringArg(args.service, "checkout-api")
              }),
              agent: agentFor("release_agent")
            },
            config
          )
        );

      case "agentgate_replay_demo_action": {
        const replay = await replayDemoAction(stringArg(args.action_id, "safe_tests"), config);
        return decisionResult(replay.decision, { action_id: replay.action_id });
      }

      case "agentgate_get_run":
        return successResult({
          status: "ok",
          skill_run: await getRun(requiredString(args.run_id, "run_id"), config)
        });

      case "agentgate_get_audit_trace":
        return successResult({
          status: "ok",
          audit_trace: await getAuditTrace(requiredString(args.trace_id, "trace_id"), config)
        });

      case "agentgate_execute_approved_run": {
        const runId = requiredString(args.run_id, "run_id");
        const token = await issueExecutionToken(runId, { approvalId: optionalString(args.approval_id) }, config);
        const queued = await executeRun(
          runId,
          {
            executionTokenId: token.execution_token.execution_token_id,
            idempotencyKey: optionalString(args.idempotency_key) ?? `mcp-${runId}-${Date.now()}`
          },
          config
        );

        return successResult({
          status: "execution_queued",
          message: "AgentGate queued the approved run. The local runner will simulate execution and write logs.",
          execution_token: token.execution_token,
          execution: queued
        });
      }

      case "agentgate_list_evidence_tasks":
        return successResult({
          status: "ok",
          evidence_tasks: await listEvidenceTasks(
            {
              skillRunId: optionalString(args.skill_run_id),
              limit: numberArg(args.limit, 0) || undefined,
              newestFirst: args.newest_first === true
            },
            config
          )
        });

      case "agentgate_claim_evidence_task":
        return successResult({
          status: "ok",
          evidence_task: await claimEvidenceTask(
            requiredString(args.task_id, "task_id"),
            {
              agentId: stringArg(args.agent_id, "claude_code_agent"),
              runtime: stringArg(args.runtime, "claude_code_mcp"),
              leaseSeconds: numberArg(args.lease_seconds, 120)
            },
            config
          )
        });

      case "agentgate_get_evidence_task":
        return successResult({
          status: "ok",
          evidence_task: await getEvidenceTask(requiredString(args.task_id, "task_id"), config)
        });

      case "agentgate_submit_evidence_result":
        return successResult({
          status: "ok",
          evidence_task: await submitEvidenceTaskResult(
            requiredString(args.task_id, "task_id"),
            {
              agentId: stringArg(args.agent_id, "claude_code_agent"),
              status: evidenceStatusArg(args.status),
              reason: requiredString(args.reason, "reason"),
              evidence: recordArg(args.evidence)
            },
            config
          )
        });

      case "agentgate_fail_evidence_task":
        return successResult({
          status: "ok",
          evidence_task: await failEvidenceTask(
            requiredString(args.task_id, "task_id"),
            {
              agentId: stringArg(args.agent_id, "claude_code_agent"),
              reason: requiredString(args.reason, "reason"),
              error: recordArg(args.error)
            },
            config
          )
        });

      default:
        return errorResult(`Unknown AgentGate MCP tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

function decisionResult(decision: AgentGateDecision, extra: Record<string, unknown> = {}): AgentGateToolResult {
  const allowed = decision.decision === "ALLOW";
  const status = statusForDecision(decision.decision);
  const payload = {
    status,
    message: messageForDecision(decision),
    ...extra,
    agentgate: {
      decision: decision.decision,
      skill_id: decision.skill_id,
      risk_level: decision.risk_level,
      run_id: decision.run_id,
      trace_id: decision.trace_id,
      reason: decision.reason,
      missing_checks: decision.missing_checks,
      dry_run_required: decision.dry_run_required
    }
  };

  return {
    content: [{ type: "text", text: redactedJson(payload) }],
    ...(allowed ? {} : { isError: true })
  };
}

function successResult(payload: unknown): AgentGateToolResult {
  return {
    content: [{ type: "text", text: redactedJson(payload) }]
  };
}

function errorResult(message: string): AgentGateToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: redactedJson({ status: "error", message: redactValue(message) }) }]
  };
}

function statusForDecision(decision: AgentGateDecision["decision"]): string {
  if (decision === "ALLOW") return "allowed";
  if (decision === "REQUIRE_APPROVAL") return "requires_approval";
  if (decision === "FORCE_DRY_RUN") return "dry_run_required";
  return "denied";
}

function messageForDecision(decision: AgentGateDecision): string {
  if (decision.decision === "ALLOW") return "AgentGate allowed the tool call. No real external side effect was executed.";
  if (decision.decision === "REQUIRE_APPROVAL") {
    const checks = decision.missing_checks?.length
      ? ` Required checks are not satisfied yet: ${decision.missing_checks.join(", ")}. Treat them as pending unless evidence says failed.`
      : "";
    return `AgentGate requires evidence and human approval before execution. Run ${decision.run_id}; trace ${decision.trace_id}.${checks}`;
  }
  if (decision.decision === "FORCE_DRY_RUN") {
    return `AgentGate requires dry-run evidence before live execution. Run ${decision.run_id}; trace ${decision.trace_id}.`;
  }
  return `AgentGate denied the tool call. Run ${decision.run_id}; trace ${decision.trace_id}.`;
}

function baseContext(args: Record<string, unknown>, environment: "dev" | "staging" | "production") {
  return compactObject({
    repo: stringArg(args.repo, "agentgate"),
    branch: optionalString(args.branch),
    cwd: optionalString(args.cwd),
    requested_skill: optionalString(args.requested_skill),
    requested_skill_id: optionalString(args.requested_skill_id),
    requested_skill_name: optionalString(args.requested_skill_name),
    original_user_prompt: optionalString(args.original_user_prompt),
    user_intent: optionalString(args.user_intent),
    environment
  });
}

function agentFor(role: "code_agent" | "release_agent" | "db_agent"): AgentGateAgent {
  if (role === "db_agent") {
    return {
      agent_id: "agent_db_001",
      agent_type: "mcp_client",
      role
    };
  }

  return {
    agent_id: "agent_code_001",
    agent_type: "coding_agent",
    role
  };
}

function requiredString(value: unknown, name: string): string {
  const resolved = optionalString(value);
  if (!resolved) throw new Error(`${name} is required.`);
  return resolved;
}

function stringArg(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function booleanArg(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function evidenceStatusArg(value: unknown): "passed" | "failed" | "missing" {
  if (value === "passed" || value === "failed" || value === "missing") return value;
  throw new Error("status must be passed, failed, or missing.");
}

function recordArg(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function environmentArg(value: unknown, fallback: "dev" | "staging" | "production"): "dev" | "staging" | "production" {
  return value === "dev" || value === "staging" || value === "production" ? value : fallback;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}
