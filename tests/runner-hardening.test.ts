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
    throw new Error("Runner hardening tests require seeded demo data. Run pnpm db:seed first.");
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
    comment: "Runner hardening approval evidence reviewed."
  });
  expect(approved.status).toBe(200);
  return approval;
}

async function approvedProductionDeploy() {
  const decision = await replay("production_deploy");
  const approval = await approveDecision(decision);
  return { decision, approval };
}

async function issueToken(app: Awaited<ReturnType<typeof createApp>>, runId: string, approvalId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/execution-tokens",
    payload: {
      skill_run_id: runId,
      approval_id: approvalId
    }
  });

  expect([200, 201]).toContain(response.statusCode);
  return response.json() as {
    execution_token: {
      execution_token_id: string;
      status: string;
      scopes: string[];
    };
  };
}

function expectStrictSequences(sequences: number[]) {
  expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, index) => index + 1));
}

describe("PR4 runner failure, retry, and idempotency hardening", () => {
  it("does not duplicate attempts or logs for duplicate idempotency requests and repeated runner scans", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const token = await issueToken(app, decision.run_id, approval.id);
    const idempotencyKey = `runner-hardening-${decision.run_id}`;

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: idempotencyKey
      }
    });
    expect(first.statusCode).toBe(202);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: idempotencyKey
      }
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      status: "duplicate",
      original_run_status: "execution_queued"
    });

    await processQueuedRunById({ prisma, runId: decision.run_id });
    const afterFirstScan = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        executionLogs: { orderBy: { sequence: "asc" } },
        skillRunAttempts: true,
        auditEvents: true,
        executionTokens: true
      }
    });
    expect(afterFirstScan.status).toBe("completed");
    expect(afterFirstScan.skillRunAttempts).toHaveLength(1);
    expect(afterFirstScan.executionLogs).toHaveLength(5);
    expectStrictSequences(afterFirstScan.executionLogs.map((log) => log.sequence));

    await processQueuedRunById({ prisma, runId: decision.run_id });
    const afterSecondScan = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        executionLogs: { orderBy: { sequence: "asc" } },
        skillRunAttempts: true,
        auditEvents: true,
        executionTokens: true
      }
    });
    expect(afterSecondScan.skillRunAttempts).toHaveLength(1);
    expect(afterSecondScan.executionLogs).toHaveLength(5);
    expectStrictSequences(afterSecondScan.executionLogs.map((log) => log.sequence));

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${decision.run_id}`
    });
    const storedHash = afterSecondScan.executionTokens[0]?.tokenHash;
    expect(detail.body).not.toContain("tokenHash");
    expect(detail.body).not.toContain("token_hash");
    expect(detail.body).not.toContain(storedHash);
    expect(JSON.stringify(afterSecondScan.auditEvents)).not.toContain(storedHash);
    expect(JSON.stringify(afterSecondScan.executionLogs)).not.toContain(storedHash);

    await app.close();
  });

  it("rejects revoked and already-used tokens before queueing execution", async () => {
    const app = await createApp({ prisma, logger: false });
    const revokedRun = await approvedProductionDeploy();
    const revokedToken = await issueToken(app, revokedRun.decision.run_id, revokedRun.approval.id);
    await prisma.executionToken.update({
      where: { id: revokedToken.execution_token.execution_token_id },
      data: {
        status: "revoked",
        revokedAt: new Date()
      }
    });

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${revokedRun.decision.run_id}/execute`,
      payload: {
        execution_token_id: revokedToken.execution_token.execution_token_id,
        idempotency_key: `revoked-${revokedRun.decision.run_id}`
      }
    });
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json()).toMatchObject({ error: "Execution token has been revoked" });

    const usedRun = await approvedProductionDeploy();
    const usedToken = await issueToken(app, usedRun.decision.run_id, usedRun.approval.id);
    await prisma.executionToken.update({
      where: { id: usedToken.execution_token.execution_token_id },
      data: {
        status: "used",
        usedAt: new Date()
      }
    });

    const reused = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${usedRun.decision.run_id}/execute`,
      payload: {
        execution_token_id: usedToken.execution_token.execution_token_id,
        idempotency_key: `used-second-${usedRun.decision.run_id}`
      }
    });
    expect(reused.statusCode).toBe(403);
    expect(reused.json()).toMatchObject({ error: "Execution token has already been used" });

    const revokedAttempts = await prisma.skillRunAttempt.count({
      where: { skillRunId: revokedRun.decision.run_id }
    });
    const revokedLogs = await prisma.executionLog.count({
      where: { skillRunId: revokedRun.decision.run_id }
    });
    expect(revokedAttempts).toBe(0);
    expect(revokedLogs).toBe(0);
    await expect(
      prisma.skillRunAttempt.count({
        where: { skillRunId: usedRun.decision.run_id }
      })
    ).resolves.toBe(0);

    await app.close();
  });

  it("captures connector failure and retries with a new token without corrupting log sequences", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const original = await prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } });

    await prisma.skillRun.update({
      where: { id: decision.run_id },
      data: {
        rawAction: `${original.rawAction} --simulate-failure`,
        context: {
          ...(original.context as Record<string, unknown>),
          simulate_failure: true
        }
      }
    });

    const firstToken = await issueToken(app, decision.run_id, approval.id);
    const failedQueue = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: firstToken.execution_token.execution_token_id,
        idempotency_key: `failure-${decision.run_id}`
      }
    });
    expect(failedQueue.statusCode).toBe(202);

    await processQueuedRunById({ prisma, runId: decision.run_id });
    const failedRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        auditEvents: true,
        executionLogs: { orderBy: { sequence: "asc" } },
        skillRunAttempts: true
      }
    });
    expect(failedRun.status).toBe("failed");
    expect(failedRun.skillRunAttempts).toHaveLength(1);
    expect(failedRun.skillRunAttempts[0]?.status).toBe("failed");
    expect(failedRun.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["execution.failed", "audit.finalized"])
    );
    expectStrictSequences(failedRun.executionLogs.map((log) => log.sequence));

    const retryToken = await issueToken(app, decision.run_id, approval.id);
    expect(retryToken.execution_token.execution_token_id).not.toBe(firstToken.execution_token.execution_token_id);

    await prisma.skillRun.update({
      where: { id: decision.run_id },
      data: {
        rawAction: original.rawAction,
        context: {
          ...(original.context as Record<string, unknown>),
          simulate_failure: false
        }
      }
    });

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/retry`,
      payload: {
        execution_token_id: retryToken.execution_token.execution_token_id,
        idempotency_key: `retry-${decision.run_id}`
      }
    });
    expect(retry.statusCode).toBe(202);

    await processQueuedRunById({ prisma, runId: decision.run_id });
    const retriedRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        auditEvents: true,
        executionLogs: { orderBy: { sequence: "asc" } },
        executionTokens: { orderBy: { createdAt: "asc" } },
        skillRunAttempts: { orderBy: { createdAt: "asc" } }
      }
    });

    expect(retriedRun.status).toBe("completed");
    expect(retriedRun.skillRunAttempts.map((attempt) => attempt.status)).toEqual(["failed", "completed"]);
    expect(retriedRun.executionTokens.map((token) => token.status)).toEqual(["used", "used"]);
    expect(retriedRun.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["credential.reissued", "execution.retry_requested", "execution.completed"])
    );
    expectStrictSequences(retriedRun.executionLogs.map((log) => log.sequence));

    await app.close();
  });
});
