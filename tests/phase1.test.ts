import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api-server/src/app";
import { createDecisionService } from "../apps/api-server/src/services/decision-service";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { scoreRisk } from "@agentgate/risk-engine";
import { resolveSkill } from "@agentgate/skill-resolver";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Phase 1 tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 1 resolver, risk, and policy engines", () => {
  it("maps canonical raw actions into governed skills", () => {
    expect(resolveSkill({ rawAction: "pnpm test" }).skill_id).toBe("run-tests");
    expect(resolveSkill({ rawAction: "gh pr merge --merge" }).skill_id).toBe("merge-pr");
    expect(resolveSkill({ rawAction: "mcp.postgres.drop_table({})" }).skill_id).toBe("drop-table");
  });

  it("scores production database migration as critical", () => {
    const resolvedSkill = resolveSkill({ rawAction: "npm run migrate:prod" });
    const risk = scoreRisk({
      resolvedSkill,
      rawAction: "npm run migrate:prod",
      context: {
        environment: "production",
        database: "prod-main",
        dry_run_completed: false
      }
    });

    expect(risk.risk_level).toBe("critical");
    expect(risk.risk_score).toBe(100);
  });

  it("applies policy precedence across all four decisions", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const decisions = fixtures.actions.actions.map((action) => {
      const payload = action.payload as {
        raw_action: string;
        tool: { tool_name: string };
        agent: { role: string };
        context: Record<string, unknown>;
      };
      const resolvedSkill = resolveSkill({
        rawAction: payload.raw_action,
        toolName: payload.tool.tool_name,
        context: payload.context
      });
      const risk = scoreRisk({
        resolvedSkill,
        rawAction: payload.raw_action,
        context: payload.context
      });
      return evaluatePolicy({
        rules: fixtures.policies.rules,
        role: payload.agent.role,
        skill_id: resolvedSkill.skill_id,
        risk_level: risk.risk_level,
        context: payload.context
      }).decision;
    });

    expect(decisions).toEqual(
      expect.arrayContaining(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"])
    );
  });

  it("does not let an ALLOW policy downgrade a high-risk alias match", () => {
    const result = evaluatePolicy({
      rules: [
        {
          policy_id: "allow_run_tests",
          name: "Allow run tests",
          priority: 10,
          when: { skill: "run-tests" },
          decision: "ALLOW",
          reason: "Running tests is safe."
        }
      ],
      role: "code_agent",
      skill_id: "claude_command:repo:sync-translations",
      skill_aliases: ["unknown-destructive", "run-tests"],
      risk_level: "critical",
      context: { environment: "production" }
    });

    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.matched_policy?.policy_id).toBe("allow_run_tests");
    expect(result.reason).toContain("High-risk action matched allow policy");
    expect(result.approvers).toEqual(["service_owner"]);
  });
});

describe("Phase 1 Decision API and MCP subset", () => {
  it("persists a decision run and audit events", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const action = fixtures.actions.actions.find((candidate) => candidate.id === "production_deploy");
    expect(action).toBeDefined();

    const service = createDecisionService({ prisma, configDir });
    const decision = await service.evaluate(action?.payload);
    const run = await prisma.skillRun.findUnique({
      where: { id: decision.run_id },
      include: { auditEvents: true }
    });

    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(run?.traceId).toBe(decision.trace_id);
    expect(run?.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "skill.invocation.received",
        "skill.classified",
        "risk.scored",
        "policy.evaluated"
      ])
    );
  });

  it("requires approval when an imported production skill has an unsafe ALLOW policy alias", async () => {
    const suffix = `risk-floor-${randomUUID().slice(0, 8)}`;
    const skillId = `claude_command:test:${suffix}`;
    const skillRecordId = `skill_${suffix.replace(/-/g, "_")}`;
    const versionId = `skillver_${suffix.replace(/-/g, "_")}`;

    await prisma.skill.create({
      data: {
        id: skillRecordId,
        tenantId: "tenant_demo",
        workspaceId: "workspace_demo",
        skillId,
        name: suffix,
        category: "read_only",
        description: "Imported command with a mistakenly attached run-tests policy alias.",
        defaultRiskLevel: "low",
        status: "active",
        versions: {
          create: {
            id: versionId,
            tenantId: "tenant_demo",
            workspaceId: "workspace_demo",
            version: "import-risk-floor",
            status: "active",
            config: {
              source: {
                type: "claude_command",
                scope: "repo",
                path: `.claude/commands/${suffix}.md`,
                content_hash: `sha256:${"a".repeat(64)}`
              },
              skill_type: "execution",
              side_effect_level: "read_only",
              allowed_runtimes: ["claude_cli"],
              preferred_runtimes: ["claude_cli"],
              policy_aliases: ["run-tests"],
              required_checks: [],
              evidence_tasks: [],
              execution_snapshot: {
                body: `# ${suffix}\n\necho "should not run without approval" >> ecommerce_operations.log\n`
              }
            },
            execution: {
              execution_mode: "agent_runtime",
              live_requires_execution_token: false
            }
          }
        }
      }
    });

    const decision = await createDecisionService({ prisma, configDir }).evaluate({
      tenant_id: "tenant_demo",
      workspace_id: "workspace_demo",
      source: "mcp_proxy",
      adapter_type: "mcp_proxy",
      agent: {
        agent_id: "agent_code_001",
        agent_type: "coding_agent",
        role: "code_agent"
      },
      tool: {
        tool_name: `trigger ${suffix}`
      },
      raw_action: `trigger ${suffix}({"environment":"production"})`,
      context: {
        environment: "production",
        original_user_prompt: `trigger ${suffix}`,
        user_intent: `trigger ${suffix}`
      }
    });
    const run = await prisma.skillRun.findUnique({
      where: { id: decision.run_id },
      include: { approvalRequest: true }
    });

    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(decision.risk_level).toBe("critical");
    expect(run?.matchedPolicyRecordId).toBe("policy_allow_run_tests");
    expect(run?.approvalRequest?.status).toBe("pending");
    expect(run?.status).toBe("approval_required");
  });

  it("handles simplified and JSON-RPC MCP payloads", async () => {
    const app = await createApp({ prisma, logger: false });

    const simplified = await app.inject({
      method: "POST",
      url: "/api/v1/mcp/invoke",
      payload: {
        tenant_id: "tenant_demo",
        workspace_id: "workspace_demo",
        agent: {
          agent_id: "agent_db_001",
          agent_type: "mcp_client",
          role: "db_agent"
        },
        server: "postgres-demo",
        tool_name: "mcp.postgres.drop_table",
        arguments: { table: "users" },
        context: {
          database: "prod-main",
          environment: "production"
        }
      }
    });

    const simplifiedBody = simplified.json() as { decision: string };
    expect(simplified.statusCode).toBe(200);
    expect(simplifiedBody.decision).toBe("DENY");

    const jsonRpc = await app.inject({
      method: "POST",
      url: "/api/v1/mcp/invoke",
      payload: {
        jsonrpc: "2.0",
        id: "call_001",
        method: "tools/call",
        params: {
          name: "mcp.postgres.drop_table",
          arguments: { table: "users" },
          _meta: {
            tenant_id: "tenant_demo",
            workspace_id: "workspace_demo",
            agent: {
              agent_id: "agent_db_001",
              agent_type: "mcp_client",
              role: "db_agent"
            },
            context: {
              database: "prod-main",
              environment: "production"
            }
          }
        }
      }
    });

    const jsonRpcBody = jsonRpc.json() as {
      result: { isError: boolean; agentgate: { decision: string } };
    };
    expect(jsonRpc.statusCode).toBe(200);
    expect(jsonRpcBody.result.isError).toBe(true);
    expect(jsonRpcBody.result.agentgate.decision).toBe("DENY");

    const invalidMethod = await app.inject({
      method: "POST",
      url: "/api/v1/mcp/invoke",
      payload: {
        jsonrpc: "2.0",
        id: "bad_call",
        method: "resources/list"
      }
    });
    expect(invalidMethod.json()).toMatchObject({
      error: {
        code: -32601
      }
    });

    await app.close();
  });
});
