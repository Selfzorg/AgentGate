import { join } from "node:path";
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
