import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
import { executeEvidenceRuntime } from "../apps/api-server/src/services/evidence-runtimes";
import type { EvidenceSkillDefinition } from "../apps/api-server/src/services/evidence-skill-registry";
import { callAgentGateTool, listAgentGateTools, redactText, redactedJson } from "../apps/mcp-proxy/src/index";

type HookOutput = {
  decision?: "allow" | "deny";
  permissionDecision: "allow" | "deny";
  permissionDecisionReason: string;
  agentgate?: {
    decision?: string;
    run_id?: string;
    trace_id?: string;
    dry_run_required?: boolean;
    delegated_to?: string;
    tool_name?: string;
    offline?: boolean;
    mode?: string;
  };
};

type HookModule = {
  runHookEvent: (
    event: Record<string, unknown>,
    env?: Record<string, string | undefined>,
    options?: { writeDebugLog?: boolean }
  ) => Promise<HookOutput>;
};

type NormalizerModule = {
  normalizeClaudeEvent: (event: Record<string, unknown>, env?: Record<string, string | undefined>) => {
    normalizedToolName: string;
    normalizedRequest: {
      raw_action: string;
      context: Record<string, unknown>;
    };
  };
  normalizeMcpToolName: (toolName: string) => string;
};

type CodexNormalizerModule = {
  normalizeCodexEvent: (event: Record<string, unknown>, env?: Record<string, string | undefined>) => {
    normalizedToolName: string;
    supported: boolean;
    normalizedRequest: {
      source: string;
      raw_action: string;
      context: Record<string, unknown>;
      tool: { tool_name: string };
    };
    safety: { isClearlySafe: boolean };
  };
  normalizeMcpToolName: (toolName: string) => string;
};

type HookRedactModule = {
  redactValue: (value: unknown) => unknown;
};

const prisma = new PrismaClient();
let app: FastifyInstance;
let baseUrl: string;
let hook: HookModule;
let normalizer: NormalizerModule;
let codexHook: HookModule;
let codexNormalizer: CodexNormalizerModule;
let hookRedact: HookRedactModule;

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Integration tests require seeded demo data. Run pnpm db:seed first.");
  }

  app = await createApp({ prisma, logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  hook = (await import(pathToFileURL(join(process.cwd(), ".agentgate/hooks/claude-pretooluse.mjs")).href)) as HookModule;
  normalizer = (await import(
    pathToFileURL(join(process.cwd(), ".agentgate/hooks/lib/normalize-claude-event.mjs")).href
  )) as NormalizerModule;
  codexHook = (await import(pathToFileURL(join(process.cwd(), ".agentgate/hooks/codex-pretooluse.mjs")).href)) as HookModule;
  codexNormalizer = (await import(
    pathToFileURL(join(process.cwd(), ".agentgate/hooks/lib/normalize-codex-event.mjs")).href
  )) as CodexNormalizerModule;
  hookRedact = (await import(pathToFileURL(join(process.cwd(), ".agentgate/hooks/lib/redact.mjs")).href)) as HookRedactModule;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Claude Code hook integration", () => {
  it("maps a safe Bash command to ALLOW", async () => {
    const output = await runHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      cwd: process.cwd()
    });

    expect(output.permissionDecision).toBe("allow");
    expect(output.agentgate?.decision).toBe("ALLOW");
  });

  it("blocks a production migration with FORCE_DRY_RUN", async () => {
    const output = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm run migrate:prod" },
        cwd: process.cwd()
      },
      {
        AGENTGATE_AGENT_ID: "agent_db_001",
        AGENTGATE_AGENT_TYPE: "db_agent",
        AGENTGATE_AGENT_ROLE: "db_agent"
      }
    );

    expect(output.permissionDecision).toBe("deny");
    expect(output.agentgate?.decision).toBe("FORCE_DRY_RUN");
    expect(output.agentgate?.dry_run_required).toBe(true);
  });

  it("blocks a production deploy with REQUIRE_APPROVAL", async () => {
    const output = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: "vercel deploy --prod",
          context: {
            service: "checkout-api",
            ci_status: "passed",
            tests_status: "passed",
            rollback_plan: "exists",
            staging_deploy: "success"
          }
        },
        cwd: process.cwd()
      },
      {
        AGENTGATE_AGENT_ROLE: "release_agent"
      }
    );

    expect(output.permissionDecision).toBe("deny");
    expect(output.agentgate?.decision).toBe("REQUIRE_APPROVAL");
    expect(output.agentgate?.run_id).toMatch(/^run_/);
    expect(output.agentgate?.trace_id).toMatch(/^trc_/);
  });

  it("blocks a research agent production deploy with DENY", async () => {
    const output = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "deploy production" },
        cwd: process.cwd()
      },
      {
        AGENTGATE_AGENT_ID: "agent_research_001",
        AGENTGATE_AGENT_TYPE: "research_agent",
        AGENTGATE_AGENT_ROLE: "research_agent"
      }
    );

    expect(output.permissionDecision).toBe("deny");
    expect(output.agentgate?.decision).toBe("DENY");
  });

  it("normalizes Claude MCP tool names to AgentGate raw actions", () => {
    const normalized = normalizer.normalizeClaudeEvent({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__github__merge_pr",
      tool_input: { pr_number: 42, target_branch: "main" }
    });

    expect(normalizer.normalizeMcpToolName("mcp__github__merge_pr")).toBe("mcp.github.merge_pr");
    expect(normalized.normalizedToolName).toBe("mcp.github.merge_pr");
    expect(normalized.normalizedRequest.raw_action).toContain("mcp.github.merge_pr");
    expect(normalized.normalizedRequest.context.target_branch).toBe("main");
  });

  it("allows AgentGate MCP tool calls through to the MCP proxy for governance", async () => {
    const output = await runHook({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__agentgate__agentgate_deploy_production",
      tool_input: { service: "checkout-api" }
    });

    expect(output.permissionDecision).toBe("allow");
    expect(output.agentgate?.delegated_to).toBe("agentgate_mcp_proxy");
    expect(output.agentgate?.tool_name).toBe("mcp.agentgate.agentgate_deploy_production");
  });

  it("fails closed for dangerous commands when the API is unavailable", async () => {
    const output = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "vercel deploy --prod" }
      },
      {
        AGENTGATE_API_BASE_URL: "http://127.0.0.1:1",
        AGENTGATE_HOOK_FAIL_MODE: "open",
        AGENTGATE_HOOK_TIMEOUT_MS: "150"
      }
    );

    expect(output.permissionDecision).toBe("deny");
    expect(output.agentgate?.offline).toBe(true);
  });

  it("fails open in observe mode for safe commands only when configured", async () => {
    const output = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" }
      },
      {
        AGENTGATE_API_BASE_URL: "http://127.0.0.1:1",
        AGENTGATE_HOOK_FAIL_MODE: "open",
        AGENTGATE_HOOK_TIMEOUT_MS: "150"
      }
    );

    expect(output.permissionDecision).toBe("allow");
    expect(output.agentgate?.offline).toBe(true);
    expect(output.agentgate?.mode).toBe("observe");
  });
});

describe("Codex hook integration", () => {
  it("maps a safe shell command to ALLOW", async () => {
    const output = await runCodexHook({
      hook_event_name: "PreToolUse",
      tool_name: "Shell",
      tool_input: { command: "pnpm test" },
      cwd: process.cwd()
    });

    expect(output.decision).toBe("allow");
    expect(output.permissionDecision).toBe("allow");
    expect(output.agentgate?.decision).toBe("ALLOW");
  });

  it("normalizes shell, apply_patch, and MCP tool calls", () => {
    const shell = codexNormalizer.normalizeCodexEvent({
      hook_event_name: "PreToolUse",
      tool_name: "Shell",
      tool_input: { command: "git status" }
    });
    const patch = codexNormalizer.normalizeCodexEvent({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { file_path: "apps/api-server/src/app.ts" }
    });
    const mcp = codexNormalizer.normalizeCodexEvent({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__github__merge_pr",
      tool_input: { pr_number: 42, target_branch: "main" }
    });

    expect(shell.supported).toBe(true);
    expect(shell.safety.isClearlySafe).toBe(true);
    expect(shell.normalizedRequest.source).toBe("codex");
    expect(shell.normalizedRequest.raw_action).toBe("git status");
    expect(patch.supported).toBe(true);
    expect(patch.normalizedRequest.raw_action).toBe("apply_patch apps/api-server/src/app.ts");
    expect(mcp.normalizedToolName).toBe("mcp.github.merge_pr");
    expect(mcp.normalizedRequest.tool.tool_name).toBe("mcp.github.merge_pr");
    expect(mcp.normalizedRequest.context.target_branch).toBe("main");
  });

  it("blocks direct production PR merge in enforce mode", async () => {
    const output = await runCodexHook({
      hook_event_name: "PreToolUse",
      tool_name: "Shell",
      tool_input: {
        command: "gh pr merge 42 --merge --delete-branch",
        context: {
          target_branch: "main",
          required_reviews_passed: true,
          branch_protection_satisfied: true
        }
      },
      cwd: process.cwd()
    });

    expect(output.permissionDecision).toBe("deny");
    expect(output.agentgate?.decision).toBe("REQUIRE_APPROVAL");
    expect(output.agentgate?.run_id).toMatch(/^run_/);
  });

  it("allows AgentGate MCP tools through to the MCP proxy", async () => {
    const output = await runCodexHook({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__agentgate__agentgate_deploy_production",
      tool_input: { service: "checkout-api" }
    });

    expect(output.permissionDecision).toBe("allow");
    expect(output.agentgate?.delegated_to).toBe("agentgate_mcp_proxy");
    expect(output.agentgate?.tool_name).toBe("mcp.agentgate.agentgate_deploy_production");
  });

  it("fails closed for dangerous commands when the API is unavailable", async () => {
    const output = await runCodexHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Shell",
        tool_input: { command: "vercel deploy --prod" }
      },
      {
        AGENTGATE_API_BASE_URL: "http://127.0.0.1:1",
        AGENTGATE_HOOK_FAIL_MODE: "open",
        AGENTGATE_HOOK_TIMEOUT_MS: "150"
      }
    );

    expect(output.permissionDecision).toBe("deny");
    expect(output.agentgate?.offline).toBe(true);
  });

  it("fails open in observe mode for safe commands only when configured", async () => {
    const output = await runCodexHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Shell",
        tool_input: { command: "pnpm test" }
      },
      {
        AGENTGATE_API_BASE_URL: "http://127.0.0.1:1",
        AGENTGATE_HOOK_FAIL_MODE: "open",
        AGENTGATE_HOOK_TIMEOUT_MS: "150"
      }
    );

    expect(output.permissionDecision).toBe("allow");
    expect(output.agentgate?.offline).toBe(true);
    expect(output.agentgate?.mode).toBe("observe");
  });
});

describe("AgentGate MCP proxy integration", () => {
  it("exposes the expected MCP tools", () => {
    expect(listAgentGateTools().map((tool) => tool.name)).toEqual([
      "agentgate_run_tests",
      "agentgate_create_pr",
      "agentgate_merge_pr",
      "agentgate_apply_migration",
      "agentgate_drop_table",
      "agentgate_deploy_staging",
      "agentgate_deploy_production",
      "agentgate_replay_demo_action",
      "agentgate_get_run",
      "agentgate_get_audit_trace",
      "agentgate_execute_approved_run",
      "agentgate_list_evidence_tasks",
      "agentgate_claim_evidence_task",
      "agentgate_get_evidence_task",
      "agentgate_submit_evidence_result",
      "agentgate_fail_evidence_task"
    ]);
  });

  it("returns DENY/isError for drop table", async () => {
    const result = await callMcp("agentgate_drop_table", { table: "users" });
    const payload = parseMcpText(result);

    expect(result.isError).toBe(true);
    expect(payload.agentgate.decision).toBe("DENY");
  });

  it("returns ALLOW/success for run tests", async () => {
    const result = await callMcp("agentgate_run_tests", { command: "pnpm test" });
    const payload = parseMcpText(result);

    expect(result.isError).toBeUndefined();
    expect(payload.agentgate.decision).toBe("ALLOW");
  });

  it("returns REQUIRE_APPROVAL/isError with evidence-backed gate checks for production deploy", async () => {
    const result = await callMcp("agentgate_deploy_production", { service: "checkout-api" });
    const payload = parseMcpText(result);

    expect(result.isError).toBe(true);
    expect(payload.agentgate.decision).toBe("REQUIRE_APPROVAL");
    expect(payload.agentgate.run_id).toMatch(/^run_/);
    expect(payload.agentgate.trace_id).toMatch(/^trc_/);

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: payload.agentgate.run_id },
      include: { gateCheckResults: { orderBy: { checkKey: "asc" } }, evidenceTasks: true, approvalRequest: true }
    });
    const context = run.context as Record<string, unknown>;
    expect(context.ci_status).toBeUndefined();
    expect(context.tests_status).toBeUndefined();
    expect(context.rollback_plan).toBeUndefined();
    expect(context.staging_deploy).toBeUndefined();
    expect(run.approvalRequest?.approvalReadiness).toBe("collecting");
    expect(run.evidenceTasks).toHaveLength(4);
    expect(run.evidenceTasks.every((task) => task.status === "queued")).toBe(true);
    expect(run.gateCheckResults.every((check) => check.status === "running")).toBe(true);
    expect(run.gateCheckResults.every((check) => (check.evidence as { source?: string }).source === "evidence_task")).toBe(true);
    const queuedCiCheck = run.gateCheckResults.find((check) => check.checkKey === "ci_passed");
    const queuedCiEvidence = queuedCiCheck?.evidence as Record<string, unknown>;
    expect(queuedCiEvidence.selected_runtime).toBe("codex_cli");

    await processEvidenceForRun(payload.agentgate.run_id);

    const completedRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: payload.agentgate.run_id },
      include: { gateCheckResults: { orderBy: { checkKey: "asc" } }, evidenceTasks: true, approvalRequest: true }
    });
    expect(completedRun.approvalRequest?.approvalReadiness).toBe("ready");
    expect(completedRun.gateCheckResults.every((check) => check.status === "passed")).toBe(true);
    const ciCheck = completedRun.gateCheckResults.find((check) => check.checkKey === "ci_passed");
    const ciEvidence = ciCheck?.evidence as Record<string, unknown>;
    const ciEvidenceSkill = ciEvidence.evidence_skill as Record<string, unknown>;
    expect(ciEvidence.selected_runtime).toBe("local_deterministic");
    expect(ciEvidenceSkill.skill_id).toBe("verify-ci-status");
    expect(ciEvidenceSkill.skill_type).toBe("evidence");
    expect(ciEvidenceSkill.side_effect_level).toBe("read_only");
    expect(ciEvidenceSkill.registry_source).toBe("database");

    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: {
        skillRunId: completedRun.id,
        eventType: "evidence.collection.passed"
      },
      orderBy: { createdAt: "asc" }
    });
    const auditMetadata = auditEvent.metadata as Record<string, unknown>;
    expect(auditMetadata.selected_runtime).toBe("local_deterministic");
    expect(auditMetadata.evidence_skill_id).toBeTruthy();
  });

  it("queues an approved run through the MCP continuation tool", async () => {
    const result = await callMcp("agentgate_deploy_production", { service: "checkout-api" });
    const payload = parseMcpText(result);
    const runId = String(payload.agentgate.run_id);
    await processEvidenceForRun(runId);
    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: runId }
    });
    const approved = await approveRequest(prisma, {
      approvalId: approval.id,
      actorId: "user_service_owner",
      comment: "Release evidence checked for MCP continuation."
    });
    expect(approved.status).toBe(200);

    const executeResult = await callMcp("agentgate_execute_approved_run", {
      run_id: runId,
      idempotency_key: `integration-${runId}`
    });
    const executePayload = parseMcpText(executeResult);

    expect(executeResult.isError).toBeUndefined();
    expect(executePayload.status).toBe("execution_queued");
    expect(executePayload.execution.run_id).toBe(runId);
    expect(executePayload.execution_token.execution_token_id).toMatch(/^exec_tok_/);
    expect(redactedJson(executePayload)).not.toContain("token_hash");
  });

  it("can force a local deterministic evidence runtime per check", async () => {
    const payload = await requestProductionDeployDecision({
      evidence_runtime_overrides: {
        ci_passed: ["local_deterministic"]
      }
    });

    expect(payload.decision).toBe("REQUIRE_APPROVAL");
    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: String(payload.run_id) },
      include: { gateCheckResults: true, evidenceTasks: true }
    });
    const ciTask = run.evidenceTasks.find((task) => task.checkKey === "ci_passed");
    expect(ciTask?.runtime).toBe("local_deterministic");
    await processEvidenceForRun(String(payload.run_id));
    const completedRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: String(payload.run_id) },
      include: { gateCheckResults: true }
    });
    const ciCheck = completedRun.gateCheckResults.find((check) => check.checkKey === "ci_passed");
    const ciEvidence = ciCheck?.evidence as Record<string, unknown>;
    expect(ciEvidence.selected_runtime).toBe("local_deterministic");
    expect(ciEvidence.mode).toBe("deterministic_local_runtime");
  });

  it("falls back from unconfigured native connector evidence runtime to local deterministic", async () => {
    const payload = await requestProductionDeployDecision({
      evidence_runtime_overrides: {
        ci_passed: ["native_connector", "local_deterministic"]
      }
    });

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: String(payload.run_id) },
      include: { gateCheckResults: true, evidenceTasks: true }
    });
    const ciTask = run.evidenceTasks.find((task) => task.checkKey === "ci_passed");
    expect(ciTask?.runtime).toBe("native_connector");
    await processEvidenceForRun(String(payload.run_id));
    const completedRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: String(payload.run_id) },
      include: { gateCheckResults: true }
    });
    const ciCheck = completedRun.gateCheckResults.find((check) => check.checkKey === "ci_passed");
    const ciEvidence = ciCheck?.evidence as Record<string, unknown>;
    expect(ciEvidence.selected_runtime).toBe("local_deterministic");
    expect(ciEvidence.runtime_fallbacks ?? []).toEqual([]);
  });

  it("lets an MCP agent claim and submit an evidence task", async () => {
    const payload = await requestProductionDeployDecision({});
    const task = await prisma.evidenceTask.findFirstOrThrow({
      where: {
        skillRunId: String(payload.run_id),
        checkKey: "rollback_plan_exists",
        status: "queued"
      }
    });

    const listed = parseMcpText(
      await callMcp("agentgate_list_evidence_tasks", {
        skill_run_id: String(payload.run_id)
      })
    );
    expect(JSON.stringify(listed)).toContain(task.id);

    const claimed = parseMcpText(
      await callMcp("agentgate_claim_evidence_task", {
        task_id: task.id,
        agent_id: "claude_code_test_agent",
        runtime: "claude_code_mcp",
        lease_seconds: 120
      })
    );
    expect(claimed.evidence_task.evidence_task.status).toBe("claimed");

    const submitted = parseMcpText(
      await callMcp("agentgate_submit_evidence_result", {
        task_id: task.id,
        agent_id: "claude_code_test_agent",
        status: "failed",
        reason: "No rollback plan file referenced the target service.",
        evidence: {
          inspected_paths: ["docs/", "README.md"]
        }
      })
    );
    expect(submitted.evidence_task.evidence_task.status).toBe("succeeded");

    const failedCheck = await prisma.gateCheckResult.findUniqueOrThrow({
      where: {
        skillRunId_checkKey: {
          skillRunId: String(payload.run_id),
          checkKey: "rollback_plan_exists"
        }
      }
    });
    expect(failedCheck.status).toBe("failed");
    expect(JSON.stringify(failedCheck.evidence)).toContain("No rollback plan file");
  });

  it("prioritizes an active evidence task ahead of older queued work", async () => {
    const payload = await requestProductionDeployDecision({});
    const tasks = await prisma.evidenceTask.findMany({
      where: {
        skillRunId: String(payload.run_id),
        status: "queued"
      },
      orderBy: { createdAt: "asc" }
    });
    expect(tasks.length).toBeGreaterThan(1);
    const target = tasks[tasks.length - 1];

    const prioritized = await fetch(`${baseUrl}/api/v1/evidence-tasks/${target.id}/prioritize`, {
      method: "POST"
    });
    expect(prioritized.status).toBe(200);
    expect((await prioritized.json()).evidence_task.priority).toBeGreaterThan(0);

    const listed = await fetch(`${baseUrl}/api/v1/evidence-tasks?skill_run_id=${payload.run_id}&limit=1`);
    expect(listed.status).toBe(200);
    expect((await listed.json()).evidence_tasks[0].id).toBe(target.id);
  });

  it("clears active evidence queue entries without deleting history", async () => {
    const payload = await requestProductionDeployDecision({});
    const response = await fetch(`${baseUrl}/api/v1/evidence-tasks/clear-active`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: "tenant_demo",
        workspace_id: "workspace_demo",
        skill_run_id: payload.run_id,
        reason: "Integration test queue clear."
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cancelled_count).toBe(4);
    expect(body.affected_run_count).toBe(1);

    const active = await prisma.evidenceTask.count({
      where: {
        skillRunId: String(payload.run_id),
        status: { in: ["queued", "claimed", "running"] }
      }
    });
    expect(active).toBe(0);

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: String(payload.run_id) },
      include: {
        approvalRequest: true,
        gateCheckResults: true,
        evidenceTasks: true
      }
    });
    expect(run.approvalRequest?.approvalReadiness).toBe("blocked");
    expect(run.gateCheckResults.every((check) => check.status === "missing")).toBe(true);
    expect(run.evidenceTasks.every((task) => task.status === "cancelled")).toBe(true);
  });

  it("surfaces evidence queue and worker heartbeat state in the monitor API", async () => {
    const payload = await requestProductionDeployDecision({});
    const task = await prisma.evidenceTask.findFirstOrThrow({
      where: {
        skillRunId: String(payload.run_id),
        status: "queued"
      }
    });

    const heartbeat = await fetch(`${baseUrl}/api/v1/evidence-workers/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: "tenant_demo",
        workspace_id: "workspace_demo",
        agent_id: "claude_monitor_test_worker",
        runtime: "claude_code_mcp",
        driver: "claude",
        status: "busy",
        current_task_id: task.id,
        current_check_key: task.checkKey,
        metadata: {
          test: true
        }
      })
    });
    expect(heartbeat.status).toBe(200);

    const monitorResponse = await fetch(`${baseUrl}/api/v1/evidence-monitor?tenant_id=tenant_demo&workspace_id=workspace_demo`);
    expect(monitorResponse.status).toBe(200);
    const monitor = await monitorResponse.json();
    expect(monitor.queue.active).toBeGreaterThanOrEqual(1);
    expect(monitor.tasks.some((candidate: { id: string }) => candidate.id === task.id)).toBe(true);
    expect(monitor.workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent_id: "claude_monitor_test_worker",
          effective_status: "busy",
          current_task_id: task.id,
          current_check_key: task.checkKey
        })
      ])
    );
    expect(monitor.events.some((event: { event_type: string }) => event.event_type.startsWith("evidence.worker."))).toBe(true);

    const stopped = await fetch(`${baseUrl}/api/v1/evidence-workers/claude_monitor_test_worker/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: "tenant_demo",
        workspace_id: "workspace_demo"
      })
    });
    expect(stopped.status).toBe(200);
  });

  it("blocks approval when an evidence subagent fails, then allows retry to make readiness ready", async () => {
    const response = await fetch(`${baseUrl}/api/v1/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: "tenant_demo",
        workspace_id: "workspace_demo",
        source: "claude-code",
        adapter_type: "hook",
        agent: {
          agent_id: "agent_code_001",
          agent_type: "coding_agent",
          role: "release_agent"
        },
        tool: {
          tool_name: "mcp.agentgate.agentgate_deploy_production"
        },
        raw_action: "mcp.agentgate.agentgate_deploy_production({\"service\":\"checkout-api\"})",
        context: {
          repo: "agentgate",
          environment: "production",
          service: "checkout-api",
          evidence_outcomes: {
            ci_passed: "failed_once"
          }
        }
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.decision).toBe("REQUIRE_APPROVAL");
    expect(payload.skill_id).toBe("deploy-production");
    expect(payload.missing_checks).toEqual(["ci_passed", "rollback_plan_exists", "staging_deploy_successful", "tests_passed"]);

    await processEvidenceForRun(payload.run_id);

    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: payload.run_id },
      include: { skillRun: { include: { gateCheckResults: true } } }
    });
    expect(approval.approvalReadiness).toBe("blocked");
    const failedCheck = approval.skillRun.gateCheckResults.find((check) => check.checkKey === "ci_passed");
    expect(failedCheck?.status).toBe("failed");
    expect(JSON.stringify(failedCheck?.evidence)).toContain("fail once");

    const blockedApproval = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "Trying to approve before evidence is fixed." })
    });
    expect(blockedApproval.status).toBe(400);
    expect(await blockedApproval.json()).toMatchObject({
      error: "Approval is blocked by missing checks",
      missing_checks: ["ci_passed"]
    });

    const retry = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}/evidence/ci_passed/retry`, {
      method: "POST"
    });
    expect(retry.status).toBe(202);
    const retryPayload = await retry.json();
    expect(retryPayload.approval.approval_readiness).toBe("collecting");
    expect(retryPayload.missing_checks).toEqual(["ci_passed"]);

    await processEvidenceForRun(payload.run_id);
    const readyApproval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approval.id }
    });
    expect(readyApproval.approvalReadiness).toBe("ready");

    const approved = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "Evidence retry passed; approving critical deploy." })
    });
    expect(approved.status).toBe(200);
  });

  it("requires a human comment for critical approvals after evidence passes", async () => {
    const result = await callMcp("agentgate_deploy_production", { service: "checkout-api" });
    const payload = parseMcpText(result);
    await processEvidenceForRun(payload.agentgate.run_id);
    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: payload.agentgate.run_id }
    });

    expect(approval.approvalReadiness).toBe("ready");
    const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Critical approvals require a non-empty comment"
    });
  });

  it("does not expose raw execution tokens or token hashes in hook/MCP output", async () => {
    const rawSecret = "agentgate-execution-token-super-secret-123456";
    const rawHash = "a".repeat(64);
    const hookOutput = await runHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "pnpm test --api-key=sk-test-redaction-placeholder-1234567890abcdef",
        context: {
          execution_token: rawSecret,
          token_hash: rawHash
        }
      }
    });
    const mcpOutput = await callMcp("agentgate_run_tests", {
      command: "pnpm test",
      execution_token: rawSecret,
      token_hash: rawHash
    });

    expect(JSON.stringify(hookOutput)).not.toContain(rawSecret);
    expect(JSON.stringify(hookOutput)).not.toContain(rawHash);
    expect(JSON.stringify(mcpOutput)).not.toContain(rawSecret);
    expect(JSON.stringify(mcpOutput)).not.toContain(rawHash);
  });

  it("redacts obvious secret-like values", () => {
    const rawSecret = "sk-test-redaction-placeholder-1234567890abcdef";
    const rawHash = "b".repeat(64);
    const hookValue = hookRedact.redactValue({
      api_key: rawSecret,
      nested: {
        authorization: `Bearer ${rawSecret}`,
        token_hash: rawHash
      }
    });
    const mcpValue = redactedJson({
      api_key: rawSecret,
      nested: {
        authorization: `Bearer ${rawSecret}`,
        token_hash: rawHash
      }
    });

    expect(JSON.stringify(hookValue)).not.toContain(rawSecret);
    expect(JSON.stringify(hookValue)).not.toContain(rawHash);
    expect(mcpValue).not.toContain(rawSecret);
    expect(mcpValue).not.toContain(rawHash);
    expect(redactText(`password=${rawSecret}`)).toContain("[REDACTED]");
  });
});

describe("Evidence runtime adapter safety", () => {
  it("refuses to execute non-evidence or mutating skills through the agent runtime", async () => {
    const executionSkill: EvidenceSkillDefinition = {
      checkKey: "ci_passed",
      skillId: "deploy-production",
      name: "Deploy Production",
      version: "1.0.0",
      connectorId: null,
      skillType: "execution",
      sideEffectLevel: "mutating",
      allowedRuntimes: ["codex_cli", "local_deterministic"],
      preferredRuntimes: ["codex_cli", "local_deterministic"],
      registrySource: "built_in_fallback"
    };

    const result = await executeEvidenceRuntime({
      checkKey: "ci_passed",
      label: "CI passed",
      attempt: 1,
      context: { repo: "agentgate", environment: "production" },
      rawAction: "vercel deploy --prod",
      targetSkillId: "deploy-production",
      requestedBy: "test",
      evidenceSkill: executionSkill
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("not an evidence skill");
    expect(result.evidence.selected_runtime).toBe("codex_cli");
    expect(result.evidence.evidence_skill_id).toBe("deploy-production");
  });
});

async function runHook(event: Record<string, unknown>, env: Record<string, string | undefined> = {}): Promise<HookOutput> {
  return hook.runHookEvent(
    event,
    {
      ...process.env,
      AGENTGATE_API_BASE_URL: baseUrl,
      AGENTGATE_PROJECT_ROOT: process.cwd(),
      ...env
    },
    { writeDebugLog: false }
  );
}

async function runCodexHook(event: Record<string, unknown>, env: Record<string, string | undefined> = {}): Promise<HookOutput> {
  return codexHook.runHookEvent(
    event,
    {
      ...process.env,
      AGENTGATE_API_BASE_URL: baseUrl,
      AGENTGATE_PROJECT_ROOT: process.cwd(),
      ...env
    },
    { writeDebugLog: false }
  );
}

async function requestProductionDeployDecision(context: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/v1/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      workspace_id: "workspace_demo",
      source: "codex",
      adapter_type: "mcp_proxy",
      agent: {
        agent_id: "agent_code_001",
        agent_type: "coding_agent",
        role: "release_agent"
      },
      tool: {
        tool_name: "mcp.agentgate.agentgate_deploy_production"
      },
      raw_action: "mcp.agentgate.agentgate_deploy_production({\"service\":\"checkout-api\"})",
      context: {
        repo: "agentgate",
        environment: "production",
        service: "checkout-api",
        ...context
      }
    })
  });

  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function processEvidenceForRun(runId: string) {
  for (let index = 0; index < 5; index += 1) {
    await processEvidenceTasksOnce({
      prisma,
      skillRunId: runId,
      limit: 20,
      agentId: `integration_evidence_worker_${index}`
    });
    const active = await prisma.evidenceTask.count({
      where: {
        skillRunId: runId,
        status: { in: ["queued", "claimed", "running"] }
      }
    });
    if (active === 0) return;
  }
  throw new Error(`Evidence tasks did not drain for ${runId}`);
}

async function callMcp(name: string, args: Record<string, unknown>) {
  return callAgentGateTool(name, args, {
    apiBaseUrl: baseUrl,
    tenantId: "tenant_demo",
    workspaceId: "workspace_demo",
    timeoutMs: 5000
  });
}

function parseMcpText(result: Awaited<ReturnType<typeof callMcp>>) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}
