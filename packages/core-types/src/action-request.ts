import type { AdapterType, AgentSource, Environment } from "./enums";

export type NormalizedActionRequest = {
  tenant_id: string;
  workspace_id: string;
  source: AgentSource;
  adapter_type: AdapterType;
  agent: {
    agent_id: string;
    agent_type: string;
    role: string;
    owner?: string;
  };
  tool: {
    tool_name: string;
    tool_call_id?: string;
  };
  raw_action: string;
  context: {
    repo?: string;
    branch?: string;
    cwd?: string;
    environment?: Environment;
    service?: string;
    database?: string;
    requested_skill?: string;
    requested_skill_id?: string;
    requested_skill_name?: string;
    original_user_prompt?: string;
    user_intent?: string;
    target_branch?: string;
    ci_status?: "passed" | "failed" | "unknown";
    tests_status?: "passed" | "failed" | "unknown";
    security_scan?: "passed" | "failed" | "unknown";
    security_scan_passed?: boolean;
    rollback_plan?: "exists" | "missing" | "unknown";
    staging_deploy?: "success" | "failed" | "unknown";
    dry_run_completed?: boolean;
    schema_diff_generated?: boolean;
    backup_exists?: boolean;
    required_reviews_passed?: boolean;
    branch_protection_satisfied?: boolean;
    evidence_outcomes?: Record<string, unknown>;
    evidence_runtime_overrides?: Record<
      string,
      Array<
        | "codex_cli"
        | "claude_cli"
        | "claude_code_mcp"
        | "codex_mcp"
        | "internal_simulated_agent"
        | "native_connector"
        | "local_deterministic"
        | "agent"
      >
    >;
  };
  requested_at?: string;
};
