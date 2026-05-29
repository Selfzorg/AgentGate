import type { NormalizedActionRequest } from "@agentgate/core-types";
import { z } from "zod";

export const normalizedActionRequestSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
  source: z.enum(["codex", "claude-code", "claude_code", "mcp_proxy", "demo_harness"]),
  adapter_type: z.enum(["hook", "mcp_proxy", "simulator"]),
  agent: z.object({
    agent_id: z.string().min(1),
    agent_type: z.string().min(1),
    role: z.string().min(1),
    owner: z.string().optional()
  }),
  tool: z.object({
    tool_name: z.string().min(1),
    tool_call_id: z.string().optional()
  }),
  raw_action: z.string().min(1),
  context: z
    .object({
      repo: z.string().optional(),
      repository: z.string().optional(),
      repo_url: z.string().optional(),
      branch: z.string().optional(),
      commit_sha: z.string().optional(),
      commit: z.string().optional(),
      head_sha: z.string().optional(),
      pr_head_sha: z.string().optional(),
      cwd: z.string().optional(),
      environment: z.enum(["dev", "staging", "production"]).optional(),
      policy_mode: z.enum(["observe", "warn", "enforce"]).optional(),
      agentgate_policy_mode: z.enum(["observe", "warn", "enforce"]).optional(),
      governance_mode: z.enum(["observe", "warn", "enforce"]).optional(),
      service: z.string().optional(),
      database: z.string().optional(),
      requested_skill: z.string().optional(),
      requested_skill_id: z.string().optional(),
      requested_skill_name: z.string().optional(),
      original_user_prompt: z.string().optional(),
      user_intent: z.string().optional(),
      target_branch: z.string().optional(),
      ci_status: z.enum(["passed", "failed", "unknown"]).optional(),
      tests_status: z.enum(["passed", "failed", "unknown"]).optional(),
      security_scan: z.enum(["passed", "failed", "unknown"]).optional(),
      rollback_plan: z.enum(["exists", "missing", "unknown"]).optional(),
      staging_deploy: z.enum(["success", "failed", "unknown"]).optional(),
      dry_run_completed: z.boolean().optional(),
      schema_diff_generated: z.boolean().optional(),
      backup_exists: z.boolean().optional(),
      required_reviews_passed: z.boolean().optional(),
      branch_protection_satisfied: z.boolean().optional(),
      evidence_outcomes: z.record(z.unknown()).optional(),
      evidence_runtime_overrides: z
        .record(
          z.array(
            z.enum([
              "codex_cli",
              "claude_cli",
              "claude_code_mcp",
              "codex_mcp",
              "internal_simulated_agent",
              "native_connector",
              "local_deterministic",
              "agent"
            ])
          )
        )
        .optional()
    })
    .default({}),
  requested_at: z.string().optional()
});

export function normalizeActionRequest(rawRequest: unknown): NormalizedActionRequest {
  const request = normalizedActionRequestSchema.parse(rawRequest);

  return {
    ...request,
    source: request.source === "claude_code" ? "claude-code" : request.source
  } as NormalizedActionRequest;
}

export function prismaAgentSource(source: NormalizedActionRequest["source"]) {
  return source === "claude-code" ? "claude_code" : source;
}
