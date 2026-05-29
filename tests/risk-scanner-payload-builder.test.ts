import {
  buildSkillSimulationPayload,
  defaultEnvironmentFor,
  defaultRawActionForSkill,
  isSkillCompatibleWithSource
} from "../apps/web-dashboard/components/risk-scanner/payload-builder";
import type { SkillRecord } from "../apps/web-dashboard/lib/api-client";
import { describe, expect, it } from "vitest";

describe("risk scanner imported skill payload builder", () => {
  it("builds a Claude Code simulation payload from an approved Claude command", () => {
    const skill = importedSkill({
      name: "prod-deployment",
      sourceType: "claude_command",
      risk: "high",
      sideEffect: "mutating",
      declaredTools: ["Bash(vercel deploy:*)"]
    });

    expect(isSkillCompatibleWithSource(skill, "claude-code")).toBe(true);
    expect(isSkillCompatibleWithSource(skill, "codex")).toBe(false);
    expect(defaultEnvironmentFor(skill)).toBe("production");
    expect(defaultRawActionForSkill(skill)).toBe("/prod-deployment checkout-api");

    const payload = buildSkillSimulationPayload({
      skill,
      source: "claude-code",
      environment: "production",
      policyMode: "enforce"
    });

    expect(payload).toMatchObject({
      source: "claude-code",
      adapter_type: "hook",
      agent: {
        role: "release_agent"
      },
      tool: {
        tool_name: "/prod-deployment"
      },
      raw_action: "/prod-deployment checkout-api",
      context: {
        environment: "production",
        policy_mode: "enforce"
      }
    });
  });

  it("routes MCP tools through the MCP proxy payload source", () => {
    const skill = importedSkill({
      name: "mcp.agentgate.agentgate_drop_table",
      sourceType: "mcp_tool",
      risk: "critical",
      sideEffect: "mutating",
      declaredTools: ["mcp.agentgate.agentgate_drop_table"]
    });

    expect(isSkillCompatibleWithSource(skill, "mcp_proxy")).toBe(true);
    expect(isSkillCompatibleWithSource(skill, "claude-code")).toBe(false);

    const payload = buildSkillSimulationPayload({
      skill,
      source: "mcp_proxy",
      environment: "production",
      policyMode: "warn"
    });

    expect(payload).toMatchObject({
      source: "mcp_proxy",
      adapter_type: "mcp_proxy",
      agent: {
        agent_type: "mcp_client"
      },
      tool: {
        tool_name: "mcp.agentgate.agentgate_drop_table"
      },
      context: {
        policy_mode: "warn"
      }
    });
  });
});

function importedSkill(input: {
  name: string;
  sourceType: string;
  risk: SkillRecord["default_risk_level"];
  sideEffect: string;
  declaredTools: string[];
}): SkillRecord {
  return {
    id: `skill_${input.name}`,
    skill_id: `${input.sourceType}:repo:${input.name}`,
    name: input.name,
    category: "execution",
    default_risk_level: input.risk,
    description: null,
    status: "active",
    version: "import-abc123def456",
    version_status: "active",
    connector: null,
    config: {
      source: {
        type: input.sourceType,
        path: `.claude/commands/${input.name}.md`
      },
      side_effect_level: input.sideEffect,
      declared_tools: input.declaredTools
    },
    execution: {}
  };
}
