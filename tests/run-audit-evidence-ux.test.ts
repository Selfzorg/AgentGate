import { join } from "node:path";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { createDecisionService } from "../apps/api-server/src/services/decision-service";
import { collectEvidenceForRun } from "../apps/api-server/src/services/evidence-collection-service";
import { processQueuedRunById } from "../apps/runner-worker/src/runner-loop";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Run/audit/evidence UX tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function replay(actionId: string) {
  const fixtures = await loadDemoFixtures(configDir);
  const action = fixtures.actions.actions.find((candidate) => candidate.id === actionId);
  expect(action).toBeDefined();
  return createDecisionService({ prisma, configDir }).evaluate(action?.payload);
}

describe("run, audit, evidence UX APIs", () => {
  it("returns searchable run index rows with approvals, counts, links, and next action context", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("production_deploy");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs?q=${encodeURIComponent(decision.run_id)}&limit=100`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      skill_runs: Array<{
        id: string;
        trace_id: string;
        approval: { id: string; status: string } | null;
        counts: { gate_checks: number; evidence_tasks: number; audit_events: number; execution_logs: number };
        latest_audit_event: { event_type: string } | null;
        next_action: string;
        no_gate_check_reason: string | null;
      }>;
    };
    const run = body.skill_runs.find((candidate) => candidate.id === decision.run_id);
    expect(run).toBeTruthy();
    expect(run?.trace_id).toBe(decision.trace_id);
    expect(run?.approval?.status).toBe("pending");
    expect(run?.counts.gate_checks).toBeGreaterThan(0);
    expect(run?.counts.audit_events).toBeGreaterThan(0);
    expect(run?.latest_audit_event?.event_type).toBeTruthy();
    expect(run?.next_action).toMatch(/evidence|gate|approve/i);
    expect(run?.no_gate_check_reason).toBeNull();

    const statusFilter = await app.inject({
      method: "GET",
      url: "/api/v1/skill-runs?status=approval_pending&limit=5"
    });
    expect(statusFilter.statusCode).toBe(200);

    await app.close();
  });

  it("groups audit traces and filters audit events by event type", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("production_deploy");

    const grouped = await app.inject({
      method: "GET",
      url: `/api/v1/audit-traces?run_id=${encodeURIComponent(decision.run_id)}`
    });
    expect(grouped.statusCode).toBe(200);
    const groupedBody = grouped.json() as {
      audit_traces: Array<{
        trace_id: string;
        skill_run_id: string | null;
        event_count: number;
        lifecycle: { observed_events: string[]; missing_events: string[] };
      }>;
    };
    expect(groupedBody.audit_traces[0]).toMatchObject({
      trace_id: decision.trace_id,
      skill_run_id: decision.run_id
    });
    expect(groupedBody.audit_traces[0]?.event_count).toBeGreaterThan(0);
    expect(groupedBody.audit_traces[0]?.lifecycle.observed_events).toContain("policy.evaluated");

    const filteredEvents = await app.inject({
      method: "GET",
      url: `/api/v1/audit-events?trace_id=${encodeURIComponent(decision.trace_id)}&event_type=policy.evaluated&limit=5`
    });
    expect(filteredEvents.statusCode).toBe(200);
    expect(filteredEvents.json().audit_events.every((event: { event_type: string }) => event.event_type === "policy.evaluated")).toBe(true);

    await app.close();
  });

  it("filters evidence monitor rows and enriches exact evidence task detail", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("production_deploy");
    const gate = await prisma.gateCheckResult.findFirstOrThrow({
      where: { skillRunId: decision.run_id }
    });
    await collectEvidenceForRun({
      prisma,
      runId: decision.run_id,
      checkKeys: [gate.checkKey],
      requestedBy: "ux-regression-test"
    });
    const task = await prisma.evidenceTask.findFirstOrThrow({
      where: {
        skillRunId: decision.run_id,
        checkKey: gate.checkKey
      },
      orderBy: { createdAt: "desc" }
    });

    const monitor = await app.inject({
      method: "GET",
      url: `/api/v1/evidence-monitor?tenant_id=tenant_demo&workspace_id=workspace_demo&run_id=${encodeURIComponent(decision.run_id)}&check_key=${encodeURIComponent(gate.checkKey)}`
    });
    expect(monitor.statusCode).toBe(200);
    const monitorBody = monitor.json() as { tasks: Array<{ id: string; skill_run_id: string; check_key: string }> };
    expect(monitorBody.tasks.map((candidate) => candidate.id)).toContain(task.id);
    expect(monitorBody.tasks.every((candidate) => candidate.skill_run_id === decision.run_id)).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/evidence-tasks/${task.id}`
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      evidence_task: {
        id: string;
        gate_check: { check_key: string };
        skill_run: { id: string; trace_id: string };
        audit_events: unknown[];
      };
    };
    expect(detailBody.evidence_task.id).toBe(task.id);
    expect(detailBody.evidence_task.gate_check.check_key).toBe(gate.checkKey);
    expect(detailBody.evidence_task.skill_run.id).toBe(decision.run_id);
    expect(detailBody.evidence_task.skill_run.trace_id).toBe(decision.trace_id);
    expect(detailBody.evidence_task.audit_events.length).toBeGreaterThan(0);

    await app.close();
  });

  it("writes meaningful execution logs for queue, runner, controls, connector, and final result", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("safe_tests");

    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        idempotency_key: `ux-log-${decision.run_id}`
      }
    });
    expect(queued.statusCode).toBe(202);

    await processQueuedRunById({ prisma, runId: decision.run_id });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${decision.run_id}`
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { skill_run: { execution_logs: Array<{ message: string }> } };
    const messages = body.skill_run.execution_logs.map((log) => log.message);
    expect(messages).toEqual(expect.arrayContaining([
      "Execution queue accepted.",
      "Runner claimed execution attempt.",
      "Execution controls validated.",
      "Connector selected.",
      "Connector input validation passed."
    ]));
    expect(detail.body).not.toContain("token_hash");
    expect(detail.body).not.toContain("raw_token");

    await app.close();
  });
});
