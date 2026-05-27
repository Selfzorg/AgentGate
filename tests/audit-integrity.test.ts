import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../apps/api-server/src/services/decision-service";
import { processQueuedRunById } from "../apps/runner-worker/src/runner-loop";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Audit integrity tests require seeded demo data. Run pnpm db:seed first.");
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

async function approveDecision(decision: DecisionServiceResult) {
  const approval = await prisma.approvalRequest.findUniqueOrThrow({
    where: { skillRunId: decision.run_id }
  });
  const approved = await approveRequest(prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment: "Audit integrity approval evidence reviewed."
  });
  expect(approved.status).toBe(200);
  return approval;
}

describe("PR3 audit integrity hardening", () => {
  it("reports complete lifecycle integrity for an approved token execution", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("production_deploy");
    const approval = await approveDecision(decision);

    const token = await app.inject({
      method: "POST",
      url: "/api/v1/execution-tokens",
      payload: {
        skill_run_id: decision.run_id,
        approval_id: approval.id
      }
    });
    expect(token.statusCode).toBe(201);
    const tokenBody = token.json() as { execution_token: { execution_token_id: string } };

    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: tokenBody.execution_token.execution_token_id,
        idempotency_key: `audit-integrity-${decision.run_id}`
      }
    });
    expect(queued.statusCode).toBe(202);

    await processQueuedRunById({ prisma, runId: decision.run_id });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/audit-integrity?trace_id=${decision.trace_id}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      audit_integrity: {
        complete: boolean;
        skill_run_id: string;
        missing_events: string[];
        required_events: string[];
        sequence: { complete: boolean; issues: string[] };
      };
    };

    expect(body.audit_integrity).toMatchObject({
      complete: true,
      skill_run_id: decision.run_id,
      missing_events: [],
      sequence: {
        complete: true,
        issues: []
      }
    });
    expect(body.audit_integrity.required_events).toEqual(
      expect.arrayContaining([
        "skill.invocation.received",
        "skill.classified",
        "risk.scored",
        "policy.evaluated",
        "approval.requested",
        "approval.granted",
        "credential.issued",
        "execution.queued",
        "execution.started",
        "execution.log_emitted",
        "execution.completed",
        "audit.finalized"
      ])
    );

    await app.close();
  });

  it("reports missing lifecycle events for an incomplete trace", async () => {
    const app = await createApp({ prisma, logger: false });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const runId = `run_integrity_${suffix}`;
    const traceId = `trc_integrity_${suffix}`;

    await prisma.skillRun.create({
      data: {
        id: runId,
        tenantId: "tenant_demo",
        workspaceId: "workspace_demo",
        traceId,
        source: "codex",
        adapterType: "hook",
        rawAction: "pnpm test",
        decision: "ALLOW",
        riskLevel: "low",
        riskScore: 10,
        status: "completed"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/audit-integrity?skill_run_id=${runId}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      audit_integrity: {
        complete: boolean;
        missing_events: string[];
        observed_events: string[];
      };
    };

    expect(body.audit_integrity.complete).toBe(false);
    expect(body.audit_integrity.observed_events).toEqual([]);
    expect(body.audit_integrity.missing_events).toEqual(
      expect.arrayContaining([
        "skill.invocation.received",
        "skill.classified",
        "risk.scored",
        "policy.evaluated",
        "execution.queued",
        "execution.started",
        "execution.log_emitted",
        "execution.completed",
        "audit.finalized"
      ])
    );

    await app.close();
  });

  it("keeps audit APIs read-only and append-only from HTTP", async () => {
    const app = await createApp({ prisma, logger: false });
    let event = await prisma.auditEvent.findFirst();
    if (!event) {
      await replay("safe_tests");
      event = await prisma.auditEvent.findFirst();
    }
    expect(event).toBeTruthy();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/audit-events",
      payload: {
        event_type: "audit.tamper"
      }
    });
    expect(create.statusCode).toBe(404);

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/audit-events/${event?.id}`,
      payload: {
        event_type: "audit.tamper"
      }
    });
    expect(update.statusCode).toBe(404);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/audit-events/${event?.id}`
    });
    expect(remove.statusCode).toBe(404);

    const missingQuery = await app.inject({
      method: "GET",
      url: "/api/v1/audit-integrity"
    });
    expect(missingQuery.statusCode).toBe(400);

    await app.close();
  });
});
