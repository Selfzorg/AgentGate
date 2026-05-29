import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../apps/api-server/src/services/decision-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
import { hashExecutionToken } from "../apps/api-server/src/services/execution-token-service";
import { processQueuedRunById } from "../apps/runner-worker/src/runner-loop";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Phase 5 tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 5 approved execution runtime", () => {
  it("queues and completes an approved run with a raw bearer token and immutable execution envelope", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedAction("production_deploy");
    const token = await issueToken(app, decision.run_id, approval.id, true);
    const rawToken = token.execution_token.token_value;
    expect(rawToken).toBeTruthy();

    const storedToken = await prisma.executionToken.findUniqueOrThrow({
      where: { id: token.execution_token.execution_token_id }
    });
    expect(storedToken.tokenHash).toBe(hashExecutionToken(String(rawToken)));
    expect(storedToken.tokenHash).not.toBe(rawToken);

    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token: rawToken,
        idempotency_key: `phase5-raw-bearer-${decision.run_id}`
      }
    });
    expect(queued.statusCode).toBe(202);

    const queuedRun = await getRunRecord(decision.run_id);
    const queuedAttemptResult = queuedRun.skillRunAttempts[0]?.result as Record<string, unknown>;
    const envelope = queuedAttemptResult.execution_envelope as Record<string, any>;
    expect(envelope).toMatchObject({
      version: "agentgate.execution_envelope.v1",
      run_id: decision.run_id,
      trace_id: decision.trace_id,
      skill: { skill_id: "deploy-production" },
      approved_action: { raw_action: "vercel deploy --prod", environment: "production" },
      token: {
        execution_token_id: token.execution_token.execution_token_id,
        credential_mode: "bearer"
      },
      runtime: {
        adapter: "native_connector",
        connector: "deployment-demo-connector"
      }
    });
    expect(JSON.stringify(envelope)).not.toContain(String(rawToken));
    expect(JSON.stringify(envelope)).not.toContain(storedToken.tokenHash);

    const queuedAudit = queuedRun.auditEvents.find((event) => event.eventType === "execution.queued");
    const queuedMetadata = queuedAudit?.metadata as Record<string, unknown>;
    expect(queuedMetadata.credential_mode).toBe("bearer");
    expect(JSON.stringify(queuedMetadata)).not.toContain(String(rawToken));
    expect(JSON.stringify(queuedMetadata)).not.toContain(storedToken.tokenHash);

    await processQueuedRunById({ prisma, runId: decision.run_id });
    const completedRun = await getRunRecord(decision.run_id);
    const completedAttemptResult = completedRun.skillRunAttempts[0]?.result as Record<string, any>;
    expect(completedRun.status).toBe("completed");
    expect(completedAttemptResult.execution_envelope.run_id).toBe(decision.run_id);
    expect(completedAttemptResult.execution_result).toMatchObject({
      skill_id: "deploy-production",
      status: "completed"
    });
    expect(completedRun.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["execution.started", "execution.completed", "audit.finalized"])
    );

    await app.close();
  });

  it("rejects raw bearer token reuse for a new idempotency key", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedAction("production_deploy");
    const token = await issueToken(app, decision.run_id, approval.id, true);
    const rawToken = token.execution_token.token_value;

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token: rawToken,
        idempotency_key: `phase5-reuse-first-${decision.run_id}`
      }
    });
    expect(first.statusCode).toBe(202);

    await prisma.skillRun.update({
      where: { id: decision.run_id },
      data: { status: "approved" }
    });
    const reused = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token: rawToken,
        idempotency_key: `phase5-reuse-second-${decision.run_id}`
      }
    });

    expect(reused.statusCode).toBe(403);
    expect(reused.json()).toMatchObject({ error: "Execution token has already been used" });

    await app.close();
  });

  it("does not allow a raw bearer token to execute a different approved high-risk run", async () => {
    const app = await createApp({ prisma, logger: false });
    const deploy = await approvedAction("production_deploy");
    const token = await issueToken(app, deploy.decision.run_id, deploy.approval.id, true);
    const secondDeploy = await approvedAction("production_deploy");

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${secondDeploy.decision.run_id}/execute`,
      payload: {
        execution_token: token.execution_token.token_value,
        idempotency_key: `phase5-cross-run-${secondDeploy.decision.run_id}`
      }
    });

    expect(replay.statusCode).toBe(403);
    expect(replay.json()).toMatchObject({ error: "Execution token not found" });

    await app.close();
  });
});

async function approvedAction(actionId: string) {
  const decision = await replay(actionId);
  const approval = await approveDecision(decision);
  return { decision, approval };
}

async function replay(actionId: string) {
  const fixtures = await loadDemoFixtures(configDir);
  const action = fixtures.actions.actions.find((candidate) => candidate.id === actionId);
  expect(action).toBeDefined();
  return createDecisionService({ prisma, configDir }).evaluate(action?.payload);
}

async function processEvidenceForRun(runId: string) {
  await processEvidenceTasksOnce({
    prisma,
    skillRunId: runId,
    limit: 50,
    agentId: "phase5_evidence_worker"
  });
}

async function approveDecision(decision: DecisionServiceResult) {
  await processEvidenceForRun(decision.run_id);
  const approval = await prisma.approvalRequest.findUniqueOrThrow({
    where: { skillRunId: decision.run_id }
  });
  const approved = await approveRequest(prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment: "Phase 5 approval evidence reviewed."
  });
  expect(approved.status).toBe(200);
  return approval;
}

async function issueToken(
  app: Awaited<ReturnType<typeof createApp>>,
  runId: string,
  approvalId: string,
  includeTokenValue: boolean
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/execution-tokens",
    payload: {
      skill_run_id: runId,
      approval_id: approvalId,
      include_token_value: includeTokenValue
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json() as {
    execution_token: {
      execution_token_id: string;
      token_type: "agentgate_bearer";
      token_value_available: boolean;
      token_value?: string;
      status: string;
      scopes: string[];
    };
  };
}

async function getRunRecord(runId: string) {
  return prisma.skillRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      skillRunAttempts: { orderBy: { createdAt: "asc" } },
      auditEvents: { orderBy: [{ sequence: "asc" }, { createdAt: "asc" }] }
    }
  });
}
