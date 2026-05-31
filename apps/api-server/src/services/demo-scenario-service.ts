import { join } from "node:path";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { processQueuedRunById } from "@agentgate/runner-worker";
import { Prisma, type PrismaClient } from "@prisma/client";
import { approveRequest } from "./approval-service";
import { createDecisionService, type DecisionServiceResult } from "./decision-service";
import { runDryRun } from "./dry-run-service";
import { processEvidenceTasksOnce } from "./evidence-task-service";
import { queueSkillRunExecution } from "./execution-service";
import { issueExecutionToken } from "./execution-token-service";

export type DemoScenarioId =
  | "merge_pr_with_agentgate"
  | "production_deploy_with_agentgate"
  | "production_db_migration_with_agentgate"
  | "deny_destructive_action"
  | "retry_failed_execution";

export type DemoScenarioResult = {
  scenario_id: DemoScenarioId;
  run_id: string;
  trace_id: string;
  decision: DecisionServiceResult["decision"];
  final_status: string;
  steps: Array<{
    name: string;
    status: string;
    detail?: unknown;
  }>;
  audit_events: string[];
  log_messages: string[];
};

export async function runDemoScenario({
  prisma,
  scenarioId,
  configDir = join(process.cwd(), "configs")
}: {
  prisma: PrismaClient;
  scenarioId: DemoScenarioId;
  configDir?: string;
}): Promise<DemoScenarioResult> {
  if (scenarioId === "merge_pr_with_agentgate") {
    return runApprovedExecutionScenario({
      prisma,
      configDir,
      scenarioId,
      actionId: "merge_main",
      context: {
        required_reviews_passed: true,
        branch_protection_satisfied: true
      },
      approvalComment: "Demo merge evidence reviewed."
    });
  }

  if (scenarioId === "production_deploy_with_agentgate") {
    return runApprovedExecutionScenario({
      prisma,
      configDir,
      scenarioId,
      actionId: "production_deploy",
      approvalComment: "Demo deployment evidence reviewed."
    });
  }

  if (scenarioId === "production_db_migration_with_agentgate") {
    return runDatabaseMigrationScenario({ prisma, configDir });
  }

  if (scenarioId === "deny_destructive_action") {
    const decision = await evaluateAction({ prisma, configDir, actionId: "mcp_drop_table" });
    return summarizeScenario(prisma, scenarioId, decision, [{ name: "policy_denied", status: decision.decision }]);
  }

  return runRetryScenario({ prisma, configDir });
}

async function runApprovedExecutionScenario(input: {
  prisma: PrismaClient;
  configDir: string;
  scenarioId: DemoScenarioId;
  actionId: string;
  context?: Record<string, unknown> | undefined;
  approvalComment: string;
}) {
  const steps: DemoScenarioResult["steps"] = [];
  const decision = await evaluateAction({
    prisma: input.prisma,
    configDir: input.configDir,
    actionId: input.actionId,
    context: input.context
  });
  steps.push({ name: "decision", status: decision.decision, detail: { run_id: decision.run_id } });

  await processEvidenceTasksOnce({
    prisma: input.prisma,
    skillRunId: decision.run_id,
    limit: 50,
    agentId: `demo_${input.scenarioId}_evidence`
  });
  steps.push({ name: "evidence", status: "processed" });

  const approval = await input.prisma.approvalRequest.findUniqueOrThrow({ where: { skillRunId: decision.run_id } });
  const approved = await approveRequest(input.prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment: input.approvalComment
  });
  steps.push({ name: "approval", status: String(approved.status) });

  const token = await issueExecutionToken(input.prisma, {
    skillRunId: decision.run_id,
    approvalId: approval.id,
    requestedBy: "demo_scenario"
  });
  const tokenId = "execution_token" in token.body ? token.body.execution_token.execution_token_id : undefined;
  steps.push({ name: "token", status: token.status === 201 || token.status === 200 ? "issued" : "failed" });

  const queued = await queueSkillRunExecution(input.prisma, {
    runId: decision.run_id,
    executionTokenId: tokenId,
    idempotencyKey: `demo-${input.scenarioId}-${decision.run_id}`,
    requestedBy: "demo_scenario"
  });
  steps.push({ name: "queue", status: String(queued.status), detail: queued.body });

  const runner = await processQueuedRunById({ prisma: input.prisma, runId: decision.run_id });
  steps.push({ name: "runner", status: runner.claimed === 1 ? "completed" : "not_claimed" });

  return summarizeScenario(input.prisma, input.scenarioId, decision, steps);
}

async function runDatabaseMigrationScenario(input: { prisma: PrismaClient; configDir: string }) {
  const steps: DemoScenarioResult["steps"] = [];
  const decision = await evaluateAction({ prisma: input.prisma, configDir: input.configDir, actionId: "production_db_migration" });
  steps.push({ name: "decision", status: decision.decision });

  const dryRun = await runDryRun({
    prisma: input.prisma,
    runId: decision.run_id,
    requestedBy: "demo_scenario",
    configDir: input.configDir
  });
  steps.push({ name: "dry_run", status: String(dryRun.status), detail: dryRun.body });
  await processEvidenceTasksOnce({
    prisma: input.prisma,
    skillRunId: decision.run_id,
    limit: 50,
    agentId: "demo_scenario_dry_run_evidence_worker"
  });

  const approval = await input.prisma.approvalRequest.findUniqueOrThrow({ where: { skillRunId: decision.run_id } });
  const approved = await approveRequest(input.prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment: "Demo migration dry-run evidence reviewed."
  });
  steps.push({ name: "approval", status: String(approved.status) });

  const token = await issueExecutionToken(input.prisma, {
    skillRunId: decision.run_id,
    approvalId: approval.id,
    requestedBy: "demo_scenario"
  });
  const tokenId = "execution_token" in token.body ? token.body.execution_token.execution_token_id : undefined;
  steps.push({ name: "token", status: token.status === 201 || token.status === 200 ? "issued" : "failed" });

  const queued = await queueSkillRunExecution(input.prisma, {
    runId: decision.run_id,
    executionTokenId: tokenId,
    idempotencyKey: `demo-production-db-migration-${decision.run_id}`,
    requestedBy: "demo_scenario"
  });
  steps.push({ name: "queue", status: String(queued.status), detail: queued.body });

  const runner = await processQueuedRunById({ prisma: input.prisma, runId: decision.run_id });
  steps.push({ name: "runner", status: runner.claimed === 1 ? "completed" : "not_claimed" });

  return summarizeScenario(input.prisma, "production_db_migration_with_agentgate", decision, steps);
}

async function runRetryScenario(input: { prisma: PrismaClient; configDir: string }) {
  const scenarioId = "retry_failed_execution";
  const steps: DemoScenarioResult["steps"] = [];
  const decision = await evaluateAction({ prisma: input.prisma, configDir: input.configDir, actionId: "production_deploy" });
  steps.push({ name: "decision", status: decision.decision });

  await processEvidenceTasksOnce({
    prisma: input.prisma,
    skillRunId: decision.run_id,
    limit: 50,
    agentId: "demo_retry_evidence"
  });
  const approval = await input.prisma.approvalRequest.findUniqueOrThrow({ where: { skillRunId: decision.run_id } });
  const approved = await approveRequest(input.prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment: "Demo retry evidence reviewed."
  });
  steps.push({ name: "approval", status: String(approved.status) });

  const original = await input.prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } });
  await input.prisma.skillRun.update({
    where: { id: decision.run_id },
    data: { rawAction: `${original.rawAction} --simulate-failure` }
  });

  const firstToken = await issueExecutionToken(input.prisma, {
    skillRunId: decision.run_id,
    approvalId: approval.id,
    requestedBy: "demo_scenario"
  });
  const firstTokenId = "execution_token" in firstToken.body ? firstToken.body.execution_token.execution_token_id : undefined;
  await queueSkillRunExecution(input.prisma, {
    runId: decision.run_id,
    executionTokenId: firstTokenId,
    idempotencyKey: `demo-retry-failure-${decision.run_id}`,
    requestedBy: "demo_scenario"
  });
  await processQueuedRunById({ prisma: input.prisma, runId: decision.run_id });
  steps.push({ name: "first_execution", status: "failed" });

  await input.prisma.skillRun.update({
    where: { id: decision.run_id },
    data: { rawAction: original.rawAction, context: original.context as Prisma.InputJsonValue }
  });
  const retryToken = await issueExecutionToken(input.prisma, {
    skillRunId: decision.run_id,
    approvalId: approval.id,
    requestedBy: "demo_scenario"
  });
  const retryTokenId = "execution_token" in retryToken.body ? retryToken.body.execution_token.execution_token_id : undefined;
  const retry = await queueSkillRunExecution(input.prisma, {
    runId: decision.run_id,
    executionTokenId: retryTokenId,
    idempotencyKey: `demo-retry-success-${decision.run_id}`,
    requestedBy: "demo_scenario",
    allowRetry: true
  });
  steps.push({ name: "retry_queue", status: String(retry.status) });

  await processQueuedRunById({ prisma: input.prisma, runId: decision.run_id });
  steps.push({ name: "retry_execution", status: "completed" });

  return summarizeScenario(input.prisma, scenarioId, decision, steps);
}

async function evaluateAction(input: {
  prisma: PrismaClient;
  configDir: string;
  actionId: string;
  context?: Record<string, unknown> | undefined;
}) {
  const fixtures = await loadDemoFixtures(input.configDir);
  const action = fixtures.actions.actions.find((candidate) => candidate.id === input.actionId);
  if (!action) throw new Error(`Missing demo action ${input.actionId}`);
  const payload = structuredClone(action.payload) as Record<string, unknown>;
  payload.context = {
    ...((payload.context as Record<string, unknown> | undefined) ?? {}),
    ...(input.context ?? {})
  };

  return createDecisionService({ prisma: input.prisma, configDir: input.configDir }).evaluate(payload);
}

async function summarizeScenario(
  prisma: PrismaClient,
  scenarioId: DemoScenarioId,
  decision: DecisionServiceResult,
  steps: DemoScenarioResult["steps"]
): Promise<DemoScenarioResult> {
  const run = await prisma.skillRun.findUniqueOrThrow({
    where: { id: decision.run_id },
    include: {
      auditEvents: { orderBy: [{ sequence: "asc" }, { createdAt: "asc" }] },
      executionLogs: { orderBy: { sequence: "asc" } }
    }
  });

  return {
    scenario_id: scenarioId,
    run_id: run.id,
    trace_id: run.traceId,
    decision: decision.decision,
    final_status: run.status,
    steps,
    audit_events: run.auditEvents.map((event) => event.eventType),
    log_messages: run.executionLogs.map((log) => log.message)
  };
}
