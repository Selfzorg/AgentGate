import { join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp } from "../apps/api-server/src/app";
import { loadDemoFixtures } from "@agentgate/config-loader";
import type { DemoPolicyRule } from "@agentgate/core-types";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Risk scanner tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function sideEffectCounts(tenantId: string) {
  const [
    skillRuns,
    approvalRequests,
    gateCheckResults,
    dryRunResults,
    executionTokens,
    executionLogs,
    skillRunAttempts,
    auditEvents
  ] = await Promise.all([
    prisma.skillRun.count({ where: { tenantId } }),
    prisma.approvalRequest.count({ where: { tenantId } }),
    prisma.gateCheckResult.count({ where: { tenantId } }),
    prisma.dryRunResult.count({ where: { tenantId } }),
    prisma.executionToken.count({ where: { tenantId } }),
    prisma.executionLog.count({ where: { tenantId } }),
    prisma.skillRunAttempt.count({ where: { tenantId } }),
    prisma.auditEvent.count({ where: { tenantId } })
  ]);

  return {
    skillRuns,
    approvalRequests,
    gateCheckResults,
    dryRunResults,
    executionTokens,
    executionLogs,
    skillRunAttempts,
    auditEvents
  };
}

describe("PR2 policy simulation risk scanner", () => {
  it("loads scanner samples from PRD-style demo action fixtures", async () => {
    const app = await createApp({ prisma, logger: false });
    const fixtures = await loadDemoFixtures(configDir);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/risk-scanner/samples"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      samples: Array<{
        id: string;
        label: string;
        expected_decision: string;
        payload: { raw_action: string };
      }>;
    };
    expect(body.samples.map((sample) => sample.id)).toEqual(fixtures.actions.actions.map((action) => action.id));
    expect(body.samples.map((sample) => sample.id)).toEqual(
      expect.arrayContaining([
        "safe_tests",
        "create_pr",
        "merge_main",
        "production_deploy",
        "production_db_migration",
        "research_agent_deploy",
        "mcp_drop_table"
      ])
    );
    expect(body.samples[0]?.payload.raw_action).toBe(fixtures.actions.actions[0]?.payload.raw_action);

    await app.close();
  });

  it("simulates every demo action without creating governance or execution side effects", async () => {
    const app = await createApp({ prisma, logger: false });
    const fixtures = await loadDemoFixtures(configDir);
    const tenantId = `tenant_sim_probe_${Date.now()}`;
    const workspaceId = `workspace_sim_probe_${Date.now()}`;
    const before = await sideEffectCounts(tenantId);

    for (const action of fixtures.actions.actions) {
      const payload = {
        ...(action.payload as Record<string, unknown>),
        tenant_id: tenantId,
        workspace_id: workspaceId
      };
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/risk-scanner/simulate",
        payload: { payload }
      });
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        mode: string;
        decision: string;
        side_effects: Record<string, boolean>;
        resolved_skill: { skill_id: string };
        risk: { score: number; level: string };
        matched_policy: { policy_id: string } | null;
        gate_checks: Array<{ check_key: string; status: string }>;
        explanation: string;
        run_id?: string;
        trace_id?: string;
      };

      expect(body).toMatchObject({
        mode: "simulate",
        decision: action.expected_decision
      });
      expect(Object.values(body.side_effects).every((value) => value === false)).toBe(true);
      expect(body.resolved_skill.skill_id).toBeTruthy();
      expect(body.risk.score).toBeGreaterThanOrEqual(0);
      expect(body.risk.score).toBeLessThanOrEqual(100);
      expect(body.explanation).toContain(body.decision);
      expect(body.run_id).toBeUndefined();
      expect(body.trace_id).toBeUndefined();
    }

    await expect(sideEffectCounts(tenantId)).resolves.toEqual(before);
    await app.close();
  });

  it("surfaces registry-backed resolution in simulation responses", async () => {
    const app = await createApp({ prisma, logger: false });
    const fixtures = await loadDemoFixtures(configDir);
    const action = fixtures.actions.actions.find((candidate) => candidate.id === "production_deploy");
    expect(action).toBeDefined();

    await withTempWorkspace(async (workspace) => {
      const skillDir = join(workspace, ".agents", "skills", "prod-deploy");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        [
          "---",
          "name: Production Deploy",
          "description: Run vercel deployment to production",
          "---",
          "",
          "Deploy a release after all AgentGate evidence checks pass."
        ].join("\n"),
        "utf8"
      );

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/risk-scanner/simulate",
        payload: {
          payload: action!.payload,
          registry_root_dir: workspace
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        registry_resolution: {
          candidate_count: number;
          selected: {
            skill_id: string;
            source_type: string;
            matched_field: string;
            side_effect_level: string;
          } | null;
        };
      };
      expect(body.registry_resolution.candidate_count).toBe(1);
      expect(body.registry_resolution.selected).toMatchObject({
        skill_id: "codex_skill:repo:agents-skills-prod-deploy",
        source_type: "codex_skill",
        side_effect_level: "mutating"
      });
      expect(["path", "description"]).toContain(body.registry_resolution.selected?.matched_field);
    });

    await app.close();
  });

  it("preserves decision precedence independent of numeric priority", () => {
    const baseRule = {
      name: "Synthetic policy",
      when: {
        role: "release_agent",
        skill: "deploy-production",
        environment: "production"
      },
      reason: "Synthetic precedence proof."
    };
    const rules: DemoPolicyRule[] = [
      {
        ...baseRule,
        policy_id: "allow_high_priority",
        priority: 1000,
        decision: "ALLOW"
      },
      {
        ...baseRule,
        policy_id: "approval_low_priority",
        priority: 1,
        decision: "REQUIRE_APPROVAL"
      },
      {
        ...baseRule,
        policy_id: "dry_run_low_priority",
        priority: 1,
        decision: "FORCE_DRY_RUN"
      },
      {
        ...baseRule,
        policy_id: "deny_low_priority",
        priority: 1,
        decision: "DENY"
      }
    ];

    const input = {
      rules,
      role: "release_agent",
      skill_id: "deploy-production",
      risk_level: "high" as const,
      context: { environment: "production" }
    };

    expect(evaluatePolicy(input).decision).toBe("DENY");
    expect(evaluatePolicy({ ...input, rules: rules.filter((rule) => rule.decision !== "DENY") }).decision).toBe(
      "FORCE_DRY_RUN"
    );
    expect(
      evaluatePolicy({
        ...input,
        rules: rules.filter((rule) => !["DENY", "FORCE_DRY_RUN"].includes(rule.decision))
      }).decision
    ).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy({ ...input, rules: rules.filter((rule) => rule.decision === "ALLOW") }).decision).toBe(
      "ALLOW"
    );
  });
});

async function withTempWorkspace(test: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), "agentgate-policy-sim-"));
  try {
    await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
