import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../apps/api-server/src/services/decision-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
import { runDryRun } from "../apps/api-server/src/services/dry-run-service";
import { processQueuedRunById } from "../apps/runner-worker/src/runner-loop";
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

async function processEvidenceForRun(runId: string, agentId: string) {
  await processEvidenceTasksOnce({ prisma, skillRunId: runId, limit: 50, agentId });
}

async function approveDecision(decision: DecisionServiceResult, comment = "Phase 3 approval evidence reviewed.") {
  await processEvidenceForRun(decision.run_id, "phase3_evidence_worker");
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

async function getRunRecord(runId: string) {
  return prisma.skillRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      agent: true,
      skill: true,
      matchedPolicy: true,
      approvalRequest: true,
      dryRunResult: true,
      gateCheckResults: {
        orderBy: { checkKey: "asc" }
      },
      executionTokens: {
        orderBy: { createdAt: "asc" }
      },
      executionLogs: {
        orderBy: { sequence: "asc" }
      },
      skillRunAttempts: {
        orderBy: { createdAt: "asc" }
      },
      auditEvents: {
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }]
      }
    }
  });
}

type RunRecord = Awaited<ReturnType<typeof getRunRecord>>;

function auditEventTypes(run: RunRecord): string[] {
  return run.auditEvents.map((event) => event.eventType);
}

function expectTraceContains(run: RunRecord, requiredEvents: string[]) {
  expect(run.auditEvents.length).toBeGreaterThanOrEqual(requiredEvents.length);
  expect(auditEventTypes(run)).toEqual(expect.arrayContaining(requiredEvents));
  expect(run.auditEvents.every((event) => event.traceId === run.traceId && event.skillRunId === run.id)).toBe(true);

  const sequences = run.auditEvents.map((event) => event.sequence);
  expect(sequences.every((sequence) => typeof sequence === "number")).toBe(true);
  expect(new Set(sequences).size).toBe(sequences.length);
  expect(sequences).toEqual([...sequences].sort((left, right) => Number(left) - Number(right)));
}

describe("PR1 governance scenario harness", () => {
  it("proves fixture-backed governance decisions, approvals, dry-run, token execution, and SSE logs", async () => {
    const app = await createApp({ prisma, logger: false });
    const fixtures = await loadDemoFixtures(configDir);

    const configuredActionCards = fixtures.actions.actions.map((action) => ({
      id: action.id,
      label: action.label,
      description: action.description,
      expected_decision: action.expected_decision,
      button_label: action.button_label,
      payload_preview: action.payload_preview
    }));

    const actionsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/demo/actions"
    });
    expect(actionsResponse.statusCode).toBe(200);
    expect(actionsResponse.json()).toEqual({ actions: configuredActionCards });

    const launcherSource = await readFile(
      join(process.cwd(), "apps/web-dashboard/components/demo/DemoActionLauncher.tsx"),
      "utf8"
    );
    expect(launcherSource).toContain("getDemoActions");
    for (const action of fixtures.actions.actions) {
      expect(launcherSource).not.toContain(`"${action.id}"`);
      expect(launcherSource).not.toContain(`'${action.id}'`);
      expect(launcherSource).not.toContain(`\`${action.id}\``);
    }

    const safeDecision = await replay("safe_tests");
    const deniedDecision = await replay("research_agent_deploy");
    const approvalDecision = await replay("production_deploy");
    const dryRunDecision = await replay("production_db_migration");

    expect([safeDecision.decision, deniedDecision.decision, approvalDecision.decision, dryRunDecision.decision]).toEqual(
      expect.arrayContaining(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"])
    );

    const safeRun = await getRunRecord(safeDecision.run_id);
    expect(safeRun).toMatchObject({
      decision: "ALLOW",
      status: "policy_evaluated",
      reason: "Running tests is a safe low-risk action."
    });
    expect(safeRun.approvalRequest).toBeNull();
    expect(safeRun.dryRunResult).toBeNull();
    expect(safeRun.executionTokens).toHaveLength(0);
    expect(safeRun.executionLogs).toHaveLength(0);
    expectTraceContains(safeRun, [
      "skill.invocation.received",
      "skill.classified",
      "risk.scored",
      "policy.evaluated"
    ]);

    const deniedRun = await getRunRecord(deniedDecision.run_id);
    expect(deniedRun).toMatchObject({
      decision: "DENY",
      status: "denied"
    });
    expect(deniedRun.matchedPolicy?.policyId).toBe("research_agent_cannot_deploy");
    expect(deniedRun.approvalRequest).toBeNull();
    expect(deniedRun.dryRunResult).toBeNull();
    expect(deniedRun.executionTokens).toHaveLength(0);
    expect(deniedRun.executionLogs).toHaveLength(0);
    expectTraceContains(deniedRun, [
      "skill.invocation.received",
      "skill.classified",
      "risk.scored",
      "policy.evaluated"
    ]);

    let approvalRun = await getRunRecord(approvalDecision.run_id);
    expect(approvalRun).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      status: "approval_pending"
    });
    expect(approvalRun.matchedPolicy?.policyId).toBe("production_deploy_requires_approval");
    expect(approvalRun.approvalRequest).toMatchObject({
      status: "pending",
      approvalReadiness: "collecting"
    });
    expect(approvalRun.gateCheckResults).toHaveLength(4);
    expect(approvalRun.gateCheckResults.every((check) => check.status === "running")).toBe(true);
    expect(approvalRun.dryRunResult).toBeNull();
    expectTraceContains(approvalRun, [
      "skill.invocation.received",
      "skill.classified",
      "risk.scored",
      "policy.evaluated",
      "prerequisites.checked",
      "approval.requested"
    ]);

    await processEvidenceForRun(approvalDecision.run_id, "phase3_harness_evidence_worker");
    approvalRun = await getRunRecord(approvalDecision.run_id);
    expect(approvalRun).toMatchObject({
      status: "approval_required"
    });
    expect(approvalRun.approvalRequest).toMatchObject({
      approvalReadiness: "ready"
    });
    expect(approvalRun.gateCheckResults.every((check) => check.status === "passed")).toBe(true);

    let dryRunRun = await getRunRecord(dryRunDecision.run_id);
    expect(dryRunRun).toMatchObject({
      decision: "FORCE_DRY_RUN",
      status: "dry_run_required"
    });
    expect(dryRunRun.matchedPolicy?.policyId).toBe("production_db_migration_force_dry_run_first");
    expect(dryRunRun.approvalRequest).toBeNull();
    expect(dryRunRun.dryRunResult).toBeNull();
    expectTraceContains(dryRunRun, [
      "skill.invocation.received",
      "skill.classified",
      "risk.scored",
      "policy.evaluated",
      "prerequisites.checked"
    ]);

    const dryRun = await runDryRun({
      prisma,
      runId: dryRunDecision.run_id,
      requestedBy: "pr1-governance-harness",
      configDir
    });
    expect(dryRun.status).toBe(200);
    expect(dryRun.body).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      dry_run_result: {
        status: "completed"
      },
      missing_checks: []
    });

    dryRunRun = await getRunRecord(dryRunDecision.run_id);
    expect(dryRunRun).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      status: "approval_required"
    });
    expect(dryRunRun.dryRunResult).toMatchObject({
      status: "completed",
      summary: "Schema diff generated. 2 tables altered, 1 index added."
    });
    expect(dryRunRun.approvalRequest).toMatchObject({
      status: "pending",
      approvalReadiness: "ready"
    });
    expect(dryRunRun.gateCheckResults.every((check) => check.status === "passed")).toBe(true);
    expectTraceContains(dryRunRun, [
      "dry_run.started",
      "dry_run.completed",
      "approval.requested"
    ]);

    const approval = await approveDecision(approvalDecision, "PR1 harness release evidence reviewed.");
    approvalRun = await getRunRecord(approvalDecision.run_id);
    expect(approvalRun).toMatchObject({
      status: "approved"
    });
    expect(approvalRun.approvalRequest).toMatchObject({
      id: approval.id,
      status: "approved",
      comment: "PR1 harness release evidence reviewed."
    });
    expectTraceContains(approvalRun, ["approval.granted"]);

    const token = await issueToken(app, approvalDecision.run_id, approval.id);
    approvalRun = await getRunRecord(approvalDecision.run_id);
    expect(approvalRun).toMatchObject({ status: "credential_issued" });
    expect(approvalRun.executionTokens).toHaveLength(1);
    expect(approvalRun.executionTokens[0]).toMatchObject({
      id: token.execution_token.execution_token_id,
      status: "issued",
      approvalRequestId: approval.id
    });
    expect(approvalRun.executionTokens[0]?.tokenHash).toHaveLength(64);
    expect(JSON.stringify(token)).not.toContain(approvalRun.executionTokens[0]?.tokenHash);
    expectTraceContains(approvalRun, ["credential.issued"]);

    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${approvalDecision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `pr1-governance-${approvalDecision.run_id}`
      }
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({
      run_id: approvalDecision.run_id,
      status: "execution_queued",
      logs_url: `/api/v1/skill-runs/${approvalDecision.run_id}/logs`
    });

    approvalRun = await getRunRecord(approvalDecision.run_id);
    expect(approvalRun.executionTokens[0]).toMatchObject({
      id: token.execution_token.execution_token_id,
      status: "used"
    });
    expect(approvalRun.skillRunAttempts).toHaveLength(1);
    expect(approvalRun.skillRunAttempts[0]).toMatchObject({
      status: "queued",
      idempotencyKey: `pr1-governance-${approvalDecision.run_id}`
    });
    expectTraceContains(approvalRun, ["execution.queued"]);

    const runner = await processQueuedRunById({ prisma, runId: approvalDecision.run_id });
    expect(runner.claimed).toBe(1);

    approvalRun = await getRunRecord(approvalDecision.run_id);
    expect(approvalRun).toMatchObject({
      status: "completed"
    });
    expect(approvalRun.skillRunAttempts[0]).toMatchObject({
      status: "completed",
      executionTokenId: token.execution_token.execution_token_id
    });
    expect(approvalRun.executionLogs.map((log) => log.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(approvalRun.executionLogs.map((log) => log.message)).toEqual(
      expect.arrayContaining([
        "Starting deployment connector",
        "Using scoped token deploy:production",
        "Deployment simulation completed successfully."
      ])
    );
    expectTraceContains(approvalRun, [
      "execution.started",
      "execution.log_emitted",
      "execution.completed",
      "audit.finalized"
    ]);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${approvalDecision.run_id}`
    });
    expect(detail.body).not.toContain("tokenHash");
    expect(detail.body).not.toContain("token_hash");
    expect(detail.body).not.toContain(approvalRun.executionTokens[0]?.tokenHash);

    const logStream = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${approvalDecision.run_id}/logs`,
      headers: {
        "last-event-id": "2"
      }
    });
    expect(logStream.statusCode).toBe(200);
    expect(logStream.body).not.toContain("id: 1\n");
    expect(logStream.body).not.toContain("id: 2\n");
    expect(logStream.body).toContain("id: 3\n");
    expect(logStream.body).toContain("event: execution_log");
    expect(logStream.body).toContain("event: execution_completed");
    expect(logStream.body).toContain('"status":"completed"');

    await app.close();
  });
});

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

    const runner = await processQueuedRunById({ prisma, runId: decision.run_id });
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

    await processQueuedRunById({ prisma, runId: decision.run_id });
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

    await processQueuedRunById({ prisma, runId: decision.run_id });
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
    await processQueuedRunById({ prisma, runId: decision.run_id });

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

    await new Promise((resolve) => setTimeout(resolve, 25));
    await prisma.executionLog.create({
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
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await prisma.skillRun.update({
      where: { id: run.id },
      data: { status: "completed" }
    });

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
