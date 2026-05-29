import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { createAuditArtifact, verifyAuditArtifacts } from "../apps/api-server/src/services/audit-artifact-service";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../apps/api-server/src/services/decision-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
import { processQueuedRunById } from "../apps/runner-worker/src/runner-loop";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Phase 7 tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 7 production readiness controls", () => {
  it("runner refuses a manually queued production connector without an AgentGate credential", async () => {
    const decision = await replay("production_deploy");
    await approveDecision(decision);
    const run = await prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } });

    await prisma.skillRunAttempt.create({
      data: {
        id: `attempt_phase7_${randomUUID()}`,
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        skillRunId: run.id,
        idempotencyKey: `phase7-manual-bypass-${run.id}`,
        status: "queued"
      }
    });
    await prisma.skillRun.update({
      where: { id: run.id },
      data: { status: "execution_queued" }
    });

    const runner = await processQueuedRunById({ prisma, runId: run.id });
    expect(runner.claimed).toBe(1);

    const failed = await prisma.skillRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { skillRunAttempts: true, auditEvents: true }
    });
    expect(failed.status).toBe("failed");
    expect(JSON.stringify(failed.skillRunAttempts[0]?.error)).toContain("production_readiness");
    expect(JSON.stringify(failed.skillRunAttempts[0]?.error)).toContain("credential is required");
    expect(failed.auditEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(["execution.failed"]));
  });

  it("break-glass requires a reason and records critical severity without granting authority", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("safe_tests");

    const missingReason = await app.inject({
      method: "POST",
      url: "/api/v1/break-glass",
      payload: { run_id: decision.run_id, actor_id: "user_service_owner" }
    });
    expect(missingReason.statusCode).toBe(400);

    const recorded = await app.inject({
      method: "POST",
      url: "/api/v1/break-glass",
      payload: {
        run_id: decision.run_id,
        actor_id: "user_service_owner",
        reason: "Production incident requires manual review.",
        severity: "critical"
      }
    });
    expect(recorded.statusCode).toBe(202);
    expect(recorded.json().break_glass.production_authority_granted).toBe(false);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { skillRunId: decision.run_id, eventType: "break_glass.requested" },
      orderBy: { createdAt: "desc" }
    });
    expect(event.metadata).toMatchObject({
      severity: "critical",
      production_authority_granted: false,
      requires_out_of_band_incident_review: true
    });

    await app.close();
  });

  it("makes audit artifact tampering visible through checksum verification", async () => {
    const decision = await replay("safe_tests");
    const run = await prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } });
    const artifact = await createAuditArtifact(prisma, {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      artifactId: `phase7_artifact_${run.id}`,
      type: "evidence_snapshot",
      payload: {
        status: "passed",
        trace_id: run.traceId
      }
    });

    await expect(verifyAuditArtifacts(prisma, { skillRunId: run.id })).resolves.toMatchObject({
      complete: true,
      artifact_count: 1
    });

    const metadata = artifact.metadata as Record<string, unknown>;
    await prisma.auditArtifact.update({
      where: { id: artifact.id },
      data: {
        metadata: {
          ...metadata,
          payload: {
            status: "tampered",
            trace_id: run.traceId
          }
        }
      }
    });

    const verification = await verifyAuditArtifacts(prisma, { skillRunId: run.id });
    expect(verification.complete).toBe(false);
    expect(verification.issues[0]).toContain("checksum mismatch");
  });

  it("keeps production-readiness guidance explicit", async () => {
    const doc = await readFile(join(process.cwd(), "docs/production-readiness.md"), "utf8");
    expect(doc).toContain("environment allow lists");
    expect(doc).toContain("Break-glass is intentionally not an execution bypass");
    expect(doc).toContain("Enterprise Hook Deployment");
    expect(doc).toContain("Threat Model");
    expect(doc).toContain("Security Signoff Checklist");
  });
});

async function replay(actionId: string) {
  const fixtures = await loadDemoFixtures(configDir);
  const action = fixtures.actions.actions.find((candidate) => candidate.id === actionId);
  expect(action).toBeDefined();
  return createDecisionService({ prisma, configDir }).evaluate(action?.payload);
}

async function approveDecision(decision: DecisionServiceResult) {
  await processEvidenceTasksOnce({
    prisma,
    skillRunId: decision.run_id,
    limit: 50,
    agentId: "phase7_evidence_worker"
  });
  const approval = await prisma.approvalRequest.findUniqueOrThrow({
    where: { skillRunId: decision.run_id }
  });
  const approved = await approveRequest(prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment: "Phase 7 readiness approval."
  });
  expect(approved.status).toBe(200);
  return approval;
}
