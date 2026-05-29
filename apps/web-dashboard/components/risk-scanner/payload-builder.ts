import type { SkillRecord } from "../../lib/api-client";

export type SimulationSource = "claude-code" | "codex" | "mcp_proxy";
export type SimulationEnvironment = "dev" | "staging" | "production";
export type SimulationPolicyMode = "observe" | "warn" | "enforce";

const claudeSourceTypes = new Set(["claude_skill", "claude_command", "claude_subagent"]);

export function isImportedSkill(skill: SkillRecord) {
  return sourceTypeForSkill(skill) !== null;
}

export function sourceTypeForSkill(skill: SkillRecord) {
  const source = recordFrom(skill.config.source);
  const type = source.type;
  return typeof type === "string" && type.trim().length > 0 ? type : null;
}

export function isSkillCompatibleWithSource(skill: SkillRecord, source: SimulationSource) {
  const sourceType = sourceTypeForSkill(skill);
  if (!sourceType) return false;
  if (source === "claude-code") return claudeSourceTypes.has(sourceType);
  if (source === "codex") return sourceType === "codex_skill";
  return sourceType === "mcp_tool";
}

export function buildSkillSimulationPayload(input: {
  skill: SkillRecord;
  source: SimulationSource;
  environment: SimulationEnvironment;
  policyMode: SimulationPolicyMode;
  rawAction?: string | undefined;
}) {
  const sourceType = sourceTypeForSkill(input.skill);
  const rawAction = input.rawAction?.trim() || defaultRawAction(input.skill, sourceType);
  const mutating = input.skill.config.side_effect_level === "mutating";
  const highRisk = input.skill.default_risk_level === "high" || input.skill.default_risk_level === "critical";

  return {
    tenant_id: "tenant_demo",
    workspace_id: "workspace_demo",
    source: input.source,
    adapter_type: input.source === "mcp_proxy" ? "mcp_proxy" : "hook",
    agent: {
      agent_id: `${input.source.replace(/[^a-z0-9]+/gi, "_")}_risk_scanner`,
      agent_type: input.source === "mcp_proxy" ? "mcp_client" : "coding_agent",
      role: roleFor(input.skill, mutating || highRisk)
    },
    tool: {
      tool_name: toolNameFor(input.skill, sourceType, input.source)
    },
    raw_action: rawAction,
    context: {
      repo: "agentgate",
      service: "checkout-api",
      environment: input.environment,
      policy_mode: input.policyMode,
      ci_status: "passed",
      tests_status: "passed",
      rollback_plan: "exists",
      staging_deploy: "success",
      target_branch: "main"
    }
  };
}

export function defaultEnvironmentFor(skill: SkillRecord): SimulationEnvironment {
  if (
    skill.default_risk_level === "high" ||
    skill.default_risk_level === "critical" ||
    skill.config.side_effect_level === "mutating"
  ) {
    return "production";
  }
  return "dev";
}

export function defaultRawActionForSkill(skill: SkillRecord) {
  return defaultRawAction(skill, sourceTypeForSkill(skill));
}

function defaultRawAction(skill: SkillRecord, sourceType: string | null) {
  if (sourceType === "claude_command") {
    return `/${skill.name.replace(/^\//, "")} checkout-api`;
  }
  if (sourceType === "claude_subagent") {
    return `Ask ${skill.name} to review checkout-api production readiness.`;
  }
  if (sourceType === "mcp_tool") {
    return `${declaredTools(skill)[0] ?? skill.name}({ service: "checkout-api" })`;
  }

  const description = skill.description?.trim();
  return description ? `Use ${skill.name} to ${description}` : `Use ${skill.name}`;
}

function toolNameFor(skill: SkillRecord, sourceType: string | null, source: SimulationSource) {
  if (source === "mcp_proxy") return declaredTools(skill)[0] ?? skill.name;
  if (sourceType === "claude_command") return `/${skill.name.replace(/^\//, "")}`;
  if (sourceType === "claude_subagent") return "Task";
  return declaredTools(skill)[0] ?? "shell";
}

function roleFor(skill: SkillRecord, privileged: boolean) {
  const name = `${skill.name} ${skill.skill_id}`.toLowerCase();
  if (name.includes("migration") || name.includes("database") || name.includes("db")) return "db_agent";
  if (privileged) return "release_agent";
  return "code_agent";
}

function declaredTools(skill: SkillRecord) {
  const value = skill.config.declared_tools;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
