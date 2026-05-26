import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../apps/api-server/src/services/decision-service";
import { runDryRun } from "../apps/api-server/src/services/dry-run-service";
import { processQueuedRunsOnce } from "../apps/runner-worker/src/runner-loop";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Phase 3 tests require seeded demo data. Run pnpm db:seed first.");
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

async function approveDecision(decision: DecisionServiceResult, comment = "Phase 3 approval evidence reviewed.") {
  const approval = await prisma.approvalRequest.findUniqueOrThrow({
    where: { skillRunId: decision.run_id }
  });
  const approved = await approveRequest(prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment
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
      expires_at: string;
    };
  };
}

describe("Phase 3 execution tokens and runner", () => {
  it("issues scoped execution tokens without exposing raw token material", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/execution-tokens",
      payload: {
        skill_run_id: decision.run_id,
        approval_id: approval.id
      }
    });

    expect(response.statusCode).toBe(201);
    const bodyText = response.body;
    const body = response.json() as {
      execution_token: {
        execution_token_id: string;
        status: string;
        scopes: string[];
      };
    };
    expect(body.execution_token.status).toBe("issued");
    expect(body.execution_token.scopes).toContain("deploy:production");
    expect(bodyText).not.toContain("token_hash");
    expect(bodyText).not.toContain("tokenHash");
    expect(bodyText).not.toContain("raw_token");

    const stored = await prisma.executionToken.findUniqueOrThrow({
      where: { id: body.execution_token.execution_token_id }
    });
    expect(stored.tokenHash).toHaveLength(64);
    expect(bodyText).not.toContain(stored.tokenHash);

    await app.close();
  });

  it("rejects critical execution without a valid execution token", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision } = await approvedProductionDeploy();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        idempotency_key: `phase3-no-token-${decision.run_id}`
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "Execution rejected because execution token is required"
    });

    await app.close();
  });

  it("queues and completes an approved production deploy through the runner", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const token = await issueToken(app, decision.run_id, approval.id);

    const execute = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `phase3-success-${decision.run_id}`
      }
    });
    expect(execute.statusCode).toBe(202);
    expect(execute.json()).toMatchObject({
      run_id: decision.run_id,
      status: "execution_queued",
      logs_url: `/api/v1/skill-runs/${decision.run_id}/logs`
    });

    const runner = await processQueuedRunsOnce({ prisma });
    expect(runner.claimed).toBe(1);

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        executionLogs: { orderBy: { sequence: "asc" } },
        skillRunAttempts: true,
        auditEvents: true,
        executionTokens: true
      }
    });

    expect(run.status).toBe("completed");
    expect(run.executionTokens[0]?.status).toBe("used");
    expect(run.executionLogs.map((log) => log.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(run.executionLogs.map((log) => log.message)).toEqual(
      expect.arrayContaining([
        "Starting deployment connector",
        "Rollout plan accepted",
        "Deployment simulation completed successfully."
      ])
    );
    expect(run.skillRunAttempts[0]?.status).toBe("completed");
    expect(run.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "credential.issued",
        "execution.queued",
        "execution.started",
        "execution.log_emitted",
        "execution.completed",
        "audit.finalized"
      ])
    );

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${decision.run_id}`
    });
    expect(detail.body).not.toContain("tokenHash");
    expect(detail.body).not.toContain("token_hash");
    expect(detail.body).not.toContain(run.executionTokens[0]?.tokenHash);

    await app.close();
  });

  it("rejects expired tokens and marks them expired", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const token = await issueToken(app, decision.run_id, approval.id);

    await prisma.executionToken.update({
      where: { id: token.execution_token.execution_token_id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const execute = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `phase3-expired-${decision.run_id}`
      }
    });

    expect(execute.statusCode).toBe(403);
    expect(execute.json()).toMatchObject({ error: "Execution token has expired" });
    await expect(
      prisma.executionToken.findUniqueOrThrow({ where: { id: token.execution_token.execution_token_id } })
    ).resolves.toMatchObject({ status: "expired" });

    await app.close();
  });

  it("enforces single-use tokens while preserving idempotency for duplicate requests", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const token = await issueToken(app, decision.run_id, approval.id);
    const idempotencyKey = `phase3-idempotent-${decision.run_id}`;

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

    const secondKey = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `phase3-single-use-${decision.run_id}`
      }
    });
    expect(secondKey.statusCode).toBe(409);

    const attempts = await prisma.skillRunAttempt.count({
      where: { skillRunId: decision.run_id }
    });
    expect(attempts).toBe(1);

    await app.close();
  });

  it("captures connector failure as failed run, logs, and audit events", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const current = await prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } });
    await prisma.skillRun.update({
      where: { id: decision.run_id },
      data: {
        rawAction: `${current.rawAction} --simulate-failure`,
        context: {
          ...(current.context as Record<string, unknown>),
          simulate_failure: true
        }
      }
    });
    const token = await issueToken(app, decision.run_id, approval.id);

    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `phase3-failure-${decision.run_id}`
      }
    });
    expect(queued.statusCode).toBe(202);

    await processQueuedRunsOnce({ prisma });
    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        executionLogs: true,
        skillRunAttempts: true,
        auditEvents: true
      }
    });

    expect(run.status).toBe("failed");
    expect(run.executionLogs.map((log) => log.message)).toContain("Deployment simulation failed during rollout.");
    expect(run.skillRunAttempts[0]?.status).toBe("failed");
    expect(run.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["execution.failed", "audit.finalized"])
    );

    await app.close();
  });

  it("executes a dry-run-approved DB migration with a scoped database token", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("production_db_migration");

    const dryRun = await runDryRun({ prisma, runId: decision.run_id, configDir });
    expect(dryRun.status).toBe(200);
    const approval = await approveDecision(decision, "Dry-run evidence reviewed for live migration.");
    const token = await issueToken(app, decision.run_id, approval.id);
    expect(token.execution_token.scopes).toContain("database:migrate:production");

    const execute = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `phase3-db-${decision.run_id}`
      }
    });
    expect(execute.statusCode).toBe(202);

    await processQueuedRunsOnce({ prisma });
    await expect(prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } })).resolves.toMatchObject({
      status: "completed"
    });

    await app.close();
  });
});

describe("Phase 3 DB-backed execution log SSE", () => {
  it("resumes persisted execution logs from Last-Event-ID and closes with final status", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const token = await issueToken(app, decision.run_id, approval.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `phase3-sse-resume-${decision.run_id}`
      }
    });
    await processQueuedRunsOnce({ prisma });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${decision.run_id}/logs`,
      headers: {
        "last-event-id": "2"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("id: 1\n");
    expect(response.body).not.toContain("id: 2\n");
    expect(response.body).toContain("id: 3\n");
    expect(response.body).toContain("event: execution_completed");
    expect(response.body).toContain('"status":"completed"');

    await app.close();
  });

  it("streams logs inserted after the SSE connection opens", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("safe_tests");
    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id }
    });
    await prisma.skillRun.update({
      where: { id: run.id },
      data: { status: "execution_queued" }
    });

    const responsePromise = app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${run.id}/logs?poll_ms=10&heartbeat_ms=10`
    });

    setTimeout(() => {
      void prisma.$transaction([
        prisma.executionLog.create({
          data: {
            id: `elog_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
            tenantId: run.tenantId,
            workspaceId: run.workspaceId,
            skillRunId: run.id,
            sequence: 1,
            level: "info",
            message: "Inserted after SSE open",
            metadata: {}
          }
        }),
        prisma.skillRun.update({
          where: { id: run.id },
          data: { status: "completed" }
        })
      ]);
    }, 25);

    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: heartbeat");
    expect(response.body).toContain("Inserted after SSE open");
    expect(response.body).toContain("event: execution_completed");

    await app.close();
  });

  it("streams live activity from database state when requested as SSE", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("safe_tests");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/live/activity?once=true",
      headers: {
        accept: "text/event-stream"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: live_activity");
    expect(response.body).toContain(decision.run_id);

    await app.close();
  });

  it("does not introduce Redis or BullMQ dependencies", async () => {
    const packagePaths = [
      "package.json",
      "apps/api-server/package.json",
      "apps/runner-worker/package.json",
      "apps/web-dashboard/package.json"
    ];

    for (const packagePath of packagePaths) {
      const manifest = JSON.parse(await readFile(join(process.cwd(), packagePath), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const names = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {})
      ];

      expect(names).not.toContain("redis");
      expect(names).not.toContain("ioredis");
      expect(names).not.toContain("bullmq");
    }
  });
});
