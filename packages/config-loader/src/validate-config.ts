import { z } from "zod";

const demoActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  expected_decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"]),
  button_label: z.string(),
  payload: z.record(z.unknown()),
  payload_preview: z.record(z.unknown())
});

const demoContractDecisionSchema = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN", "UNGOVERNED"]);

const demoContractScenarioSchema = z.object({
  id: z.string(),
  label: z.string(),
  mode: z.enum(["without_agentgate", "observe", "enforce"]),
  action_id: z.string().optional(),
  prompt: z.string(),
  expected: z.object({
    decision: demoContractDecisionSchema,
    follow_up_decision: demoContractDecisionSchema.optional(),
    required_checks: z.array(z.string()).optional(),
    approvers: z.array(z.string()).optional(),
    durable_audit: z.boolean(),
    requires_approval: z.boolean(),
    requires_token: z.boolean(),
    token_scopes: z.array(z.string()).optional()
  }),
  acceptance: z.array(z.string())
});

const demoGoldenTraceSchema = z.object({
  id: z.string(),
  label: z.string(),
  scenario_id: z.string(),
  action_id: z.string(),
  deterministic: z.boolean(),
  expected_decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"]),
  expected_final_status: z.string(),
  expected_events: z.array(z.string()),
  expected_logs: z.array(z.string())
});

const demoPolicyRuleSchema = z.object({
  policy_id: z.string(),
  name: z.string(),
  priority: z.number(),
  when: z.record(z.unknown()),
  decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"]),
  reason: z.string(),
  required_checks: z.array(z.string()).optional(),
  approvers: z.array(z.string()).optional()
});

const evidenceRuntimeSchema = z.enum([
  "codex_cli",
  "claude_cli",
  "claude_code_mcp",
  "codex_mcp",
  "internal_simulated_agent",
  "native_connector",
  "local_deterministic",
  "agent"
]);

export const demoAgentsConfigSchema = z.object({
  tenant: z.object({
    id: z.string(),
    name: z.string()
  }),
  workspace: z.object({
    id: z.string(),
    key: z.string(),
    name: z.string()
  }),
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string().email(),
      name: z.string(),
      role: z.string()
    })
  ),
  agents: z.array(
    z.object({
      id: z.string(),
      external_agent_id: z.string(),
      owner_user_id: z.string().optional(),
      source: z.string(),
      agent_type: z.string(),
      role: z.string(),
      display_name: z.string()
    })
  )
});

export const demoSkillsConfigSchema = z.object({
  connectors: z.array(
    z.object({
      id: z.string(),
      connector_id: z.string(),
      name: z.string(),
      type: z.string()
    })
  ),
  skills: z.array(
    z.object({
      id: z.string(),
      skill_id: z.string(),
      name: z.string(),
      category: z.string(),
      default_risk_level: z.enum(["low", "medium", "high", "critical"]),
      connector_id: z.string(),
      version: z.string(),
      live_requires_execution_token: z.boolean(),
      supports_dry_run: z.boolean().optional(),
      skill_type: z.enum(["execution", "evidence"]).optional(),
      side_effect_level: z.enum(["read_only", "simulated", "mutating"]).optional(),
      check_key: z.string().optional(),
      allowed_runtimes: z.array(evidenceRuntimeSchema).optional(),
      preferred_runtimes: z.array(evidenceRuntimeSchema).optional()
    })
  )
});

export const demoPoliciesConfigSchema = z.object({
  rules: z.array(demoPolicyRuleSchema)
});

export const demoActionsConfigSchema = z.object({
  actions: z.array(demoActionSchema)
});

export const demoContractConfigSchema = z.object({
  version: z.number(),
  summary: z.string(),
  modes: z.array(
    z.object({
      id: z.enum(["without_agentgate", "observe", "enforce"]),
      label: z.string(),
      description: z.string()
    })
  ),
  scenarios: z.array(demoContractScenarioSchema)
});

export const demoGateChecksConfigSchema = z.object({
  checks: z.record(
    z.array(
      z.object({
        key: z.string(),
        label: z.string()
      })
    )
  )
});

export const demoGoldenTracesConfigSchema = z.object({
  traces: z.array(demoGoldenTraceSchema)
});

export type DemoAgentsConfig = z.infer<typeof demoAgentsConfigSchema>;
export type DemoSkillsConfig = z.infer<typeof demoSkillsConfigSchema>;
export type DemoPoliciesConfig = z.infer<typeof demoPoliciesConfigSchema>;
export type DemoActionsConfig = z.infer<typeof demoActionsConfigSchema>;
export type DemoContractConfig = z.infer<typeof demoContractConfigSchema>;
export type DemoGateChecksConfig = z.infer<typeof demoGateChecksConfigSchema>;
export type DemoGoldenTracesConfig = z.infer<typeof demoGoldenTracesConfigSchema>;
