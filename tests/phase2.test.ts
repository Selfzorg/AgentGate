import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { createDecisionService } from "../apps/api-server/src/services/decision-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
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

async function processEvidenceForRun(runId: string) {
  await processEvidenceTasksOnce({
    prisma,
    skillRunId: runId,
    limit: 50,
    agentId: "phase2_evidence_worker"
  });
}

describe("Phase 2 approvals and dry-runs", () => {
  it("creates an approval packet and structured gate checks for production deploy", async () => {
    const decision = await replay("production_deploy");
    await processEvidenceForRun(decision.run_id);
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
    await processEvidenceForRun(decision.run_id);
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

    const approvalSearchBeforeDryRun = await app.inject({
      method: "GET",
      url: `/api/v1/approvals?q=${encodeURIComponent(decision.run_id)}`
    });
    expect(approvalSearchBeforeDryRun.statusCode).toBe(200);
    expect(approvalSearchBeforeDryRun.json()).toMatchObject({
      approvals: [],
      related_runs: [
        {
          id: decision.run_id,
          trace_id: decision.trace_id,
          decision: "FORCE_DRY_RUN",
          status: "dry_run_required",
          dry_run_result: null
        }
      ]
    });

    const dryRun = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/dry-run`
    });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json()).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      dry_run_result: {
        status: "completed",
        result: {
          connector: "db-demo-connector",
          required_checks: ["dry_run_completed", "schema_diff_generated", "backup_exists"]
        }
      },
      missing_checks: ["backup_exists", "dry_run_completed", "schema_diff_generated"]
    });
    expect(dryRun.json().evidence_tasks).toHaveLength(3);

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        dryRunResult: true,
        gateCheckResults: true,
        approvalRequest: true
      }
    });

    expect(run.dryRunResult?.summary).toContain("Schema diff generated");
    expect(run.dryRunResult?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "schema_diff" }),
        expect.objectContaining({ type: "database_backup" })
      ])
    );
    expect(run.gateCheckResults.every((check) => check.status === "running")).toBe(true);
    expect(run.approvalRequest?.status).toBe("pending");
    expect(run.approvalRequest?.approvalReadiness).toBe("collecting");

    const dryRunEvidenceTask = await prisma.evidenceTask.findFirstOrThrow({
      where: {
        skillRunId: decision.run_id,
        checkKey: "schema_diff_generated"
      }
    });
    expect(dryRunEvidenceTask.input).toMatchObject({
      dry_run_result: {
        id: run.dryRunResult?.id,
        status: "completed",
        artifacts: expect.arrayContaining([expect.objectContaining({ type: "schema_diff" })])
      }
    });

    await processEvidenceForRun(decision.run_id);
    const verifiedRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: {
        gateCheckResults: true,
        approvalRequest: true
      }
    });
    expect(verifiedRun.gateCheckResults.every((check) => check.status === "passed")).toBe(true);
    expect(verifiedRun.approvalRequest?.approvalReadiness).toBe("ready");

    const approvalSearchAfterDryRun = await app.inject({
      method: "GET",
      url: `/api/v1/approvals?q=${encodeURIComponent(decision.run_id)}`
    });
    expect(approvalSearchAfterDryRun.statusCode).toBe(200);
    const searchAfterBody = approvalSearchAfterDryRun.json();
    expect(searchAfterBody.approvals.map((approval: { skill_run: { id: string } }) => approval.skill_run.id)).toContain(decision.run_id);
    expect(searchAfterBody.related_runs).toEqual([]);

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
    await processEvidenceForRun(decision.run_id);

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

  it("rejects dry-run for skills that do not declare dry-run support", async () => {
    const decision = await replay("production_deploy");
    const app = await createApp({ prisma, logger: false });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/dry-run`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Skill does not support dry-run",
      skill_id: "deploy-production"
    });

    await app.close();
  });

  it("supports generic dry-run skills through their connector instead of a hardcoded migration branch", async () => {
    const suffix = Date.now().toString(36);
    const skill = await prisma.skill.create({
      data: {
        id: `skill_generic_dry_${suffix}`,
        tenantId: "tenant_demo",
        workspaceId: "workspace_demo",
        skillId: `generic-dry-run-${suffix}`,
        name: "Generic Dry Run",
        category: "source_control",
        defaultRiskLevel: "low",
        description: "Generic dry-run-capable skill"
      }
    });
    await prisma.skillVersion.create({
      data: {
        id: `skillver_generic_dry_${suffix}`,
        tenantId: "tenant_demo",
        workspaceId: "workspace_demo",
        skillRecordId: skill.id,
        connectorId: "connector_github_demo",
        version: "1.0.0",
        status: "active",
        config: {
          supports_dry_run: true
        },
        execution: {}
      }
    });
    const runId = `run_generic_dry_${suffix}`;
    await prisma.skillRun.create({
      data: {
        id: runId,
        tenantId: "tenant_demo",
        workspaceId: "workspace_demo",
        traceId: `trc_generic_dry_${suffix}`,
        skillRecordId: skill.id,
        source: "demo_harness",
        adapterType: "simulator",
        rawAction: "generic dry-run action",
        environment: "production",
        mode: "enforce",
        decision: "FORCE_DRY_RUN",
        riskLevel: "low",
        riskScore: 10,
        riskReasons: [],
        context: {},
        status: "dry_run_required",
        reason: "Generic dry-run required.",
        resolvedSkillSnapshot: {
          skill_id: skill.skillId,
          skill_version: "1.0.0",
          category: "source_control",
          default_risk_level: "low",
          confidence: 1,
          resolver_reason: "test",
          supports_dry_run: true
        },
        policySnapshot: {}
      }
    });
    const app = await createApp({ prisma, logger: false });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${runId}/dry-run`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision: "ALLOW",
      dry_run_result: {
        status: "completed",
        summary: "GitHub demo dry-run placeholder.",
        result: {
          connector: "github-demo-connector",
          skill_id: skill.skillId
        }
      }
    });

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
