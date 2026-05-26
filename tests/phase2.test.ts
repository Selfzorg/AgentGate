import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { createDecisionService } from "../apps/api-server/src/services/decision-service";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Phase 2 tests require seeded demo data. Run pnpm db:seed first.");
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

describe("Phase 2 approvals and dry-runs", () => {
  it("creates an approval packet and structured gate checks for production deploy", async () => {
    const decision = await replay("production_deploy");
    const approval = await prisma.approvalRequest.findUnique({
      where: { skillRunId: decision.run_id },
      include: {
        skillRun: {
          include: { gateCheckResults: true }
        }
      }
    });

    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(approval?.status).toBe("pending");
    expect(approval?.approvalReadiness).toBe("ready");
    expect(approval?.skillRun.gateCheckResults).toHaveLength(4);
    expect(approval?.skillRun.gateCheckResults.every((check) => check.status === "passed")).toBe(true);
  });

  it("requires a comment for critical approvals and then approves with one", async () => {
    const decision = await replay("production_deploy");
    const app = await createApp({ prisma, logger: false });
    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: decision.run_id }
    });

    const missingComment = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/approve`,
      payload: {}
    });
    expect(missingComment.statusCode).toBe(400);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/approve`,
      payload: { comment: "Release evidence checked for demo approval." }
    });
    expect(approved.statusCode).toBe(200);

    const deniedAfterApproval = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/deny`,
      payload: { comment: "Trying to reverse an approved packet." }
    });
    expect(deniedAfterApproval.statusCode).toBe(409);

    const updatedRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: { approvalRequest: true }
    });
    expect(updatedRun.status).toBe("approved");
    expect(updatedRun.approvalRequest?.status).toBe("approved");

    await app.close();
  });

  it("blocks approval when required checks are missing", async () => {
    const decision = await replay("merge_main");
    const app = await createApp({ prisma, logger: false });
    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: decision.run_id }
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/approve`,
      payload: { comment: "Trying to approve with missing checks." }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Approval is blocked by missing checks"
    });

    await app.close();
  });

  it("dry-runs a production DB migration and creates an approval packet with evidence", async () => {
    const decision = await replay("production_db_migration");
    const app = await createApp({ prisma, logger: false });

    const dryRun = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/dry-run`
    });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json()).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      dry_run_result: {
        status: "completed"
      },
      missing_checks: []
    });

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        dryRunResult: true,
        gateCheckResults: true,
        approvalRequest: true
      }
    });

    expect(run.dryRunResult?.summary).toContain("Schema diff generated");
    expect(run.gateCheckResults.every((check) => check.status === "passed")).toBe(true);
    expect(run.approvalRequest?.status).toBe("pending");
    expect(run.approvalRequest?.approvalReadiness).toBe("ready");

    await app.close();
  });

  it("blocks dry-run mutation after an approval is finalized", async () => {
    const decision = await replay("production_db_migration");
    const app = await createApp({ prisma, logger: false });

    const dryRun = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/dry-run`
    });
    expect(dryRun.statusCode).toBe(200);

    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: decision.run_id }
    });

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/approve`,
      payload: { comment: "Dry-run evidence reviewed." }
    });
    expect(approved.statusCode).toBe(200);

    const forcedDryRun = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/force-dry-run`
    });
    expect(forcedDryRun.statusCode).toBe(409);

    const directDryRun = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/dry-run`
    });
    expect(directDryRun.statusCode).toBe(409);

    await app.close();
  });

  it("denied approvals block execution", async () => {
    const decision = await replay("production_deploy");
    const app = await createApp({ prisma, logger: false });
    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: decision.run_id }
    });

    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/deny`,
      payload: { comment: "Denying for test." }
    });
    expect(denied.statusCode).toBe(200);

    const execute = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: { idempotency_key: "phase2-denied-test" }
    });
    expect(execute.statusCode).toBe(403);
    expect(execute.json()).toMatchObject({
      error: "Execution rejected because approval was denied"
    });

    await app.close();
  });
});
