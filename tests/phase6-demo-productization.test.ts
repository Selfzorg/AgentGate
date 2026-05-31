import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { runDemoScenario } from "../apps/demo-agent-harness/src/run-demo-scenario";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Phase 6 tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 6 demo productization", () => {
  it("documents setup/reset/run commands and exposes golden traces", async () => {
    const app = await createApp({ prisma, logger: false });
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.scripts).toMatchObject({
      "demo:setup": "pnpm postgres:start && pnpm db:deploy && pnpm db:seed",
      "demo:reset": "node scripts/demo-reset.mjs",
      "demo:run": "tsx scripts/run-demo-scenario.ts"
    });

    const contract = await app.inject({ method: "GET", url: "/api/v1/demo/contract" });
    expect(contract.statusCode).toBe(200);
    expect(contract.json().contract.modes.map((mode: { id: string }) => mode.id)).toEqual([
      "without_agentgate",
      "observe",
      "enforce"
    ]);

    const golden = await app.inject({ method: "GET", url: "/api/v1/demo/golden-traces" });
    expect(golden.statusCode).toBe(200);
    expect(golden.json().golden_traces.traces.map((trace: { scenario_id: string }) => trace.scenario_id)).toEqual([
      "merge_pr_with_agentgate",
      "production_deploy_with_agentgate",
      "production_db_migration_with_agentgate",
      "deny_destructive_action",
      "retry_failed_execution"
    ]);

    const journeyRail = await readFile(join(process.cwd(), "apps/web-dashboard/components/demo/DemoJourneyRail.tsx"), "utf8");
    expect(journeyRail).toContain("getDemoContract");
    expect(journeyRail).toContain("without_agentgate");
    expect(journeyRail).toContain("observe");
    expect(journeyRail).toContain("enforce");

    await app.close();
  });

  it("runs the end-to-end PR merge demo with deterministic evidence and durable audit/logs", async () => {
    const app = await createApp({ prisma, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/demo/scenarios/merge_pr_with_agentgate/replay"
    });

    expect(response.statusCode).toBe(200);
    const scenario = response.json().scenario as {
      run_id: string;
      trace_id: string;
      decision: string;
      final_status: string;
      audit_events: string[];
      log_messages: string[];
    };

    expect(scenario).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      final_status: "completed"
    });
    expect(scenario.audit_events).toEqual(
      expect.arrayContaining([
        "approval.requested",
        "evidence.collection.passed",
        "approval.granted",
        "credential.issued",
        "execution.queued",
        "execution.completed",
        "audit.finalized"
      ])
    );
    expect(scenario.log_messages).toEqual(
      expect.arrayContaining(["Starting github-demo-connector", "GitHub simulation completed successfully."])
    );

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: scenario.run_id },
      include: {
        approvalRequest: true,
        gateCheckResults: true,
        executionTokens: true,
        skillRunAttempts: true,
        executionLogs: true,
        auditEvents: true
      }
    });
    expect(run.traceId).toBe(scenario.trace_id);
    expect(run.approvalRequest?.status).toBe("approved");
    expect(run.gateCheckResults.every((check) => check.status === "passed")).toBe(true);
    expect(run.executionTokens).toHaveLength(1);
    expect(run.skillRunAttempts).toHaveLength(1);
    expect(run.executionLogs.length).toBeGreaterThan(0);
    expect(run.auditEvents.some((event) => event.eventType === "audit.finalized")).toBe(true);

    await app.close();
  });

  it("lets the demo harness call a golden scenario endpoint", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(
        JSON.stringify({
          scenario: {
            scenario_id: "deny_destructive_action",
            run_id: "run_demo",
            trace_id: "trc_demo",
            decision: "DENY",
            final_status: "denied",
            steps: [],
            audit_events: ["policy.evaluated"],
            log_messages: []
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await runDemoScenario("deny_destructive_action", {
      apiBaseUrl: "http://agentgate.example",
      fetchImpl
    });

    expect(calls).toEqual([
      {
        url: "http://agentgate.example/api/v1/demo/scenarios/deny_destructive_action/replay",
        method: "POST"
      }
    ]);
    expect(result.scenario.final_status).toBe("denied");
  });
});
