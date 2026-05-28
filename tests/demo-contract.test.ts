import { join } from "node:path";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { resolveSkill } from "@agentgate/skill-resolver";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { createDecisionService } from "../apps/api-server/src/services/decision-service";
import { scopesForSkill } from "../apps/api-server/src/services/execution-token-service";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Demo contract tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("demo contract", () => {
  it("keeps the contract wired to dynamic demo fixtures instead of stale hardcoded scenarios", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const actionsById = new Map(fixtures.actions.actions.map((action) => [action.id, action]));
    const modeIds = fixtures.contract.modes.map((mode) => mode.id);

    expect(modeIds).toEqual(["without_agentgate", "observe", "enforce"]);
    expect(new Set(fixtures.contract.scenarios.map((scenario) => scenario.id)).size).toBe(fixtures.contract.scenarios.length);

    for (const scenario of fixtures.contract.scenarios) {
      expect(scenario.acceptance.length).toBeGreaterThan(0);

      if (scenario.mode === "without_agentgate") {
        expect(scenario.action_id).toBeUndefined();
        expect(scenario.expected).toMatchObject({
          decision: "UNGOVERNED",
          durable_audit: false,
          requires_approval: false,
          requires_token: false
        });
        continue;
      }

      expect(scenario.action_id).toBeDefined();
      const action = actionsById.get(scenario.action_id ?? "");
      expect(action, `Missing fixture action for ${scenario.id}`).toBeDefined();
      expect(action?.expected_decision).toBe(scenario.expected.decision);

      const payload = action?.payload as
        | {
            raw_action?: unknown;
            tool?: { tool_name?: unknown };
            context?: { environment?: string };
          }
        | undefined;
      const resolvedSkill = resolveSkill({
        rawAction: String(payload?.raw_action ?? ""),
        toolName: payload?.tool ? String(payload.tool.tool_name ?? "") : undefined,
        context: payload?.context
      });
      const configuredChecks = fixtures.gateChecks.checks[resolvedSkill.skill_id]?.map((check) => check.key) ?? [];
      expect(configuredChecks).toEqual(expect.arrayContaining(scenario.expected.required_checks ?? []));

      const expectedScopes = scenario.expected.token_scopes ?? [];
      if (expectedScopes.length > 0) {
        expect(scopesForSkill(resolvedSkill.skill_id, payload?.context?.environment)).toEqual(expect.arrayContaining(expectedScopes));
      }
    }
  });

  it("exposes the contract through the demo API for dashboard and scripted demos", async () => {
    const app = await createApp({ prisma, logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/demo/contract"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.contract.summary).toContain("AgentGate baseline demo contract");
    expect(body.contract.scenarios.map((scenario: { id: string }) => scenario.id)).toEqual([
      "merge_pr_without_agentgate",
      "merge_pr_with_agentgate",
      "production_deploy_with_agentgate",
      "production_db_migration_with_agentgate",
      "destructive_db_action_denied"
    ]);

    await app.close();
  });

  it("matches enforce-mode scenario decisions against the live decision pipeline", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const service = createDecisionService({ prisma, configDir });

    for (const scenario of fixtures.contract.scenarios.filter((candidate) => candidate.mode === "enforce")) {
      const action = fixtures.actions.actions.find((candidate) => candidate.id === scenario.action_id);
      expect(action, `Missing fixture action for ${scenario.id}`).toBeDefined();

      const decision = await service.evaluate(action!.payload);
      expect(decision.decision).toBe(scenario.expected.decision);
      expect(decision.run_id).toMatch(/^run_/);
      expect(decision.trace_id).toMatch(/^trc_/);

      const run = await prisma.skillRun.findUniqueOrThrow({
        where: { id: decision.run_id },
        include: {
          approvalRequest: true,
          evidenceTasks: true,
          executionTokens: true,
          skillRunAttempts: true,
          auditEvents: true
        }
      });

      expect(run.auditEvents.length > 0).toBe(scenario.expected.durable_audit);
      expect(Boolean(run.approvalRequest)).toBe(scenario.expected.decision === "REQUIRE_APPROVAL");
      expect(run.executionTokens).toHaveLength(0);
      expect(run.skillRunAttempts).toHaveLength(0);

      if (scenario.expected.requires_approval && scenario.expected.decision !== "REQUIRE_APPROVAL") {
        expect(scenario.expected.follow_up_decision).toBe("REQUIRE_APPROVAL");
      }

      if (scenario.expected.decision === "REQUIRE_APPROVAL") {
        expect(run.evidenceTasks.map((task) => task.checkKey)).toEqual(
          expect.arrayContaining(scenario.expected.required_checks ?? [])
        );
      }

      if (scenario.expected.decision === "DENY") {
        expect(run.evidenceTasks).toHaveLength(0);
        expect(run.status).toBe("denied");
      }
    }
  });
});
