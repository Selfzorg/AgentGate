import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoContract, loadDemoFixtures, loadDemoGoldenTraces } from "@agentgate/config-loader";
import { processQueuedRunsOnce } from "@agentgate/runner-worker";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { approveRequest } from "../services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../services/decision-service";
import { runDryRun } from "../services/dry-run-service";
import { processEvidenceTasksOnce } from "../services/evidence-task-service";
import { queueSkillRunExecution } from "../services/execution-service";
import { issueExecutionToken } from "../services/execution-token-service";
import { runDemoScenario, type DemoScenarioId } from "../services/demo-scenario-service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const configDir = join(repoRoot, "configs");
const replayParamsSchema = z.object({
  action_id: z.string()
});
const scenarioParamsSchema = z.object({
  scenario_id: z.enum([
    "merge_pr_with_agentgate",
    "production_deploy_with_agentgate",
    "production_db_migration_with_agentgate",
    "deny_destructive_action",
    "retry_failed_execution"
  ])
});

export const registerDemoRoutes: FastifyPluginAsync = async (app) => {
  app.get("/demo/contract", async () => ({
    contract: await loadDemoContract(configDir)
  }));

  app.get("/demo/golden-traces", async () => ({
    golden_traces: await loadDemoGoldenTraces(configDir)
  }));

  app.get("/demo/actions", async () => {
    const fixtures = await loadDemoFixtures(configDir);

    return {
      actions: fixtures.actions.actions.map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        expected_decision: action.expected_decision,
        button_label: action.button_label,
        payload_preview: action.payload_preview
      }))
    };
  });

  app.post("/demo/actions/:action_id/replay", async (request, reply) => {
    const { action_id: actionId } = replayParamsSchema.parse(request.params);
    const fixtures = await loadDemoFixtures(configDir);
    const action = fixtures.actions.actions.find((candidate) => candidate.id === actionId);

    if (!action) {
      return reply.code(404).send({
        error: "Demo action not found",
        action_id: actionId
      });
    }

    const service = createDecisionService({ prisma: app.services.prisma, configDir });
    const decision = await service.evaluate(action.payload);

    return {
      action_id: actionId,
      decision
    };
  });

  app.post("/demo/scenarios/:scenario_id/replay", async (request) => {
    const { scenario_id: scenarioId } = scenarioParamsSchema.parse(request.params);
    return {
      scenario: await runDemoScenario({
        prisma: app.services.prisma,
        scenarioId: scenarioId as DemoScenarioId,
        configDir
      })
    };
  });

  app.post("/demo/scenario/replay", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const service = createDecisionService({ prisma: app.services.prisma, configDir });
    const decisions: Array<{ action_id: string; decision: DecisionServiceResult }> = [];
    const executions: Array<{ action_id: string; step: string; result: unknown }> = [];

    async function replay(actionId: string) {
      const action = fixtures.actions.actions.find((candidate) => candidate.id === actionId);
      if (!action) throw new Error(`Missing demo action ${actionId}`);
      const decision = await service.evaluate(action.payload);
      decisions.push({ action_id: action.id, decision });
      return decision;
    }

    for (const actionId of ["safe_tests", "create_pr"]) {
      const decision = await replay(actionId);
      const queued = await queueSkillRunExecution(app.services.prisma, {
        runId: decision.run_id,
        idempotencyKey: `scenario-${actionId}-${decision.run_id}`,
        requestedBy: "scenario"
      });
      executions.push({ action_id: actionId, step: "execute_safe_action", result: queued.body });
    }

    await replay("merge_main");

    const migrationDecision = await replay("production_db_migration");
    const dryRun = await runDryRun({
      prisma: app.services.prisma,
      runId: migrationDecision.run_id,
      requestedBy: "scenario",
      configDir
    });
    executions.push({ action_id: "production_db_migration", step: "dry_run", result: dryRun.body });
    await processEvidenceTasksOnce({
      prisma: app.services.prisma,
      skillRunId: migrationDecision.run_id,
      limit: 50,
      agentId: "scenario_dry_run_evidence_worker"
    });

    const migrationApproval = await app.services.prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: migrationDecision.run_id }
    });
    const migrationApproved = await approveRequest(app.services.prisma, {
      approvalId: migrationApproval.id,
      actorId: "user_service_owner",
      comment: "Scenario dry-run evidence reviewed."
    });
    executions.push({ action_id: "production_db_migration", step: "approve", result: migrationApproved.body });

    const migrationToken = await issueExecutionToken(app.services.prisma, {
      skillRunId: migrationDecision.run_id,
      approvalId: migrationApproval.id,
      requestedBy: "scenario"
    });
    executions.push({ action_id: "production_db_migration", step: "issue_token", result: migrationToken.body });

    const migrationQueued = await queueSkillRunExecution(app.services.prisma, {
      runId: migrationDecision.run_id,
      executionTokenId:
        "execution_token" in migrationToken.body ? migrationToken.body.execution_token.execution_token_id : undefined,
      idempotencyKey: `scenario-production_db_migration-${migrationDecision.run_id}`,
      requestedBy: "scenario"
    });
    executions.push({ action_id: "production_db_migration", step: "execute", result: migrationQueued.body });

    const deployDecision = await replay("production_deploy");
    const deployApproval = await app.services.prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: deployDecision.run_id }
    });
    const deployApproved = await approveRequest(app.services.prisma, {
      approvalId: deployApproval.id,
      actorId: "user_service_owner",
      comment: "Scenario release evidence reviewed."
    });
    executions.push({ action_id: "production_deploy", step: "approve", result: deployApproved.body });

    const deployToken = await issueExecutionToken(app.services.prisma, {
      skillRunId: deployDecision.run_id,
      approvalId: deployApproval.id,
      requestedBy: "scenario"
    });
    executions.push({ action_id: "production_deploy", step: "issue_token", result: deployToken.body });

    const deployQueued = await queueSkillRunExecution(app.services.prisma, {
      runId: deployDecision.run_id,
      executionTokenId: "execution_token" in deployToken.body ? deployToken.body.execution_token.execution_token_id : undefined,
      idempotencyKey: `scenario-production_deploy-${deployDecision.run_id}`,
      requestedBy: "scenario"
    });
    executions.push({ action_id: "production_deploy", step: "execute", result: deployQueued.body });

    const runner = await processQueuedRunsOnce({ prisma: app.services.prisma, limit: 10 });

    return {
      scenario: "phase_3_governed_execution",
      decisions,
      executions,
      runner
    };
  });
};
