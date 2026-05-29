import { z } from "zod";

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
