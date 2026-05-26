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
    target_branch?: string;
    ci_status?: "passed" | "failed" | "unknown";
    tests_status?: "passed" | "failed" | "unknown";
    security_scan?: "passed" | "failed" | "unknown";
    rollback_plan?: "exists" | "missing" | "unknown";
    staging_deploy?: "success" | "failed" | "unknown";
    dry_run_completed?: boolean;
  };
  requested_at?: string;
};
