import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDemoFixtures } from "@agentgate/config-loader";
import type { AiProvider, AiProviderConfig, AiProviderRequest, AiProviderResult } from "@agentgate/ai-provider";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../apps/api-server/src/services/decision-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
import { generateRunAnalysis } from "../apps/api-server/src/services/ai-run-analysis-service";
import { processQueuedRunById } from "../apps/runner-worker/src/runner-loop";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");
const enabledConfig = {
  enabled: true,
  provider: "mock",
  model: "mock-cheap",
  maxInputTokens: 4000,
  dailyBudgetCents: 1_000_000
} satisfies AiProviderConfig;
const disabledConfig = {
  ...enabledConfig,
  enabled: false
} satisfies AiProviderConfig;

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("AI Run Intelligence tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

class CapturingProvider implements AiProvider {
  calls: AiProviderRequest[] = [];

  constructor(
    private readonly content = JSON.stringify({
      summary: "Advisory summary only.",
      severity: "low",
      risk_notes: ["Deterministic governance remains authoritative."],
      missing_evidence: [],
      suggested_actions: ["Review persisted audit evidence."],
      failure_cause: null,
      approver_notes: null
    }),
    private readonly shouldThrow = false
  ) {}

  async completeJson(request: AiProviderRequest): Promise<AiProviderResult> {
    this.calls.push(request);
    if (this.shouldThrow) throw new Error("mock provider unavailable");

    return {
      content: this.content,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    };
  }
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
    agentId: "ai_run_evidence_worker"
  });
}

async function approveDecision(decision: DecisionServiceResult, comment = "AI test approval evidence reviewed.") {
  await processEvidenceForRun(decision.run_id);
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

describe("AI Run Intelligence", () => {
  it("does not let LLM output change deterministic governance decisions", async () => {
    const decision = await replay("safe_tests");
    expect(decision.decision).toBe("ALLOW");
    const before = await prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } });
    const provider = new CapturingProvider(
      JSON.stringify({
        summary: "This advisory text asks for escalation but must not affect policy.",
        severity: "critical",
        risk_notes: ["The LLM cannot change ALLOW/DENY/REQUIRE_APPROVAL/FORCE_DRY_RUN."],
        missing_evidence: ["none"],
        suggested_actions: ["Do not mutate deterministic state."],
        failure_cause: null,
        approver_notes: null
      })
    );

    const result = await generateRunAnalysis({
      prisma,
      runId: decision.run_id,
      provider,
      config: enabledConfig
    });
    expect(result.status).toBe(201);

    const after = await prisma.skillRun.findUniqueOrThrow({ where: { id: decision.run_id } });
    expect(after.decision).toBe(before.decision);
    expect(after.status).toBe(before.status);
    expect(provider.calls).toHaveLength(1);
  });

  it("stores failed analysis when the provider fails without breaking approval or audit flows", async () => {
    const decision = await replay("production_deploy");
    const provider = new CapturingProvider(undefined, true);
    const result = await generateRunAnalysis({
      prisma,
      runId: decision.run_id,
      provider,
      config: enabledConfig
    });
    expect(result.status).toBe(200);
    expect(result.body.ai_analysis.status).toBe("failed");

    const approval = await approveDecision(decision, "Approval still works after advisory failure.");
    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: { auditEvents: true, approvalRequest: true }
    });
    expect(run.status).toBe("approved");
    expect(run.approvalRequest?.id).toBe(approval.id);
    expect(run.auditEvents.map((event) => event.eventType)).toContain("approval.granted");
  });

  it("redacts raw tokens, token IDs, token hashes, authorization headers, and secrets before model calls and stored analysis", async () => {
    const decision = await replay("safe_tests");
    const activeToken = "agentgate-live-token-for-redaction";
    const fakeHash = "a".repeat(64);
    const fakeTokenId = "exec_tok_redactionsecretid";
    await prisma.skillRun.update({
      where: { id: decision.run_id },
      data: {
        context: {
          active_execution_token: activeToken,
          nested: {
            execution_token: activeToken
          }
        }
      }
    });
    await prisma.executionLog.create({
      data: {
        id: `log_ai_redaction_${decision.run_id}`,
        tenantId: "tenant_demo",
        workspaceId: "workspace_demo",
        skillRunId: decision.run_id,
        sequence: 1,
        level: "error",
        message: `Authorization: Bearer should-not-leave ${activeToken} ${fakeTokenId} ${fakeHash}`,
        metadata: {
          API_KEY: "api-key-should-not-leave",
          password: "password-should-not-leave",
          token_id: fakeTokenId,
          token_hash: fakeHash,
          raw: activeToken
        }
      }
    });
    const provider = new CapturingProvider(
      JSON.stringify({
        summary: `Provider echoed ${activeToken} ${fakeTokenId} ${fakeHash} Authorization: Bearer provider-secret`,
        severity: "high",
        risk_notes: [`secret=provider-secret ${activeToken}`],
        missing_evidence: [],
        suggested_actions: [`Do not show ${fakeTokenId}`],
        failure_cause: null,
        approver_notes: null
      })
    );

    const result = await generateRunAnalysis({
      prisma,
      runId: decision.run_id,
      provider,
      config: enabledConfig
    });

    const payload = provider.calls[0]?.user ?? "";
    expect(payload).toContain("[REDACTED_AGENTGATE_TOKEN]");
    expect(payload).not.toContain(activeToken);
    expect(payload).not.toContain(fakeTokenId);
    expect(payload).not.toContain(fakeHash);
    expect(payload).not.toContain("should-not-leave");
    expect(payload).not.toContain("api-key-should-not-leave");
    expect(payload).not.toContain("password-should-not-leave");

    const storedAnalysis = JSON.stringify(result.body.ai_analysis);
    expect(storedAnalysis).toContain("[REDACTED_AGENTGATE_TOKEN]");
    expect(storedAnalysis).not.toContain(activeToken);
    expect(storedAnalysis).not.toContain(fakeTokenId);
    expect(storedAnalysis).not.toContain(fakeHash);
    expect(storedAnalysis).not.toContain("provider-secret");
  });

  it("does not introduce raw-token storage in the execution token schema", async () => {
    const schema = await readFile(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const executionTokenModel = schema.match(/model ExecutionToken \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(executionTokenModel).toContain("tokenHash");
    expect(executionTokenModel).not.toContain("rawToken");
    expect(executionTokenModel).not.toContain("raw_token");
  });

  it("rejects malformed model output and stores a failed analysis", async () => {
    const decision = await replay("safe_tests");
    const provider = new CapturingProvider(JSON.stringify({ summary: "", severity: "danger" }));
    const result = await generateRunAnalysis({
      prisma,
      runId: decision.run_id,
      provider,
      config: enabledConfig
    });

    expect(result.status).toBe(200);
    expect(result.body.ai_analysis.status).toBe("failed");
    expect(result.body.ai_analysis.error).toBeTruthy();
  });

  it("generates pending approval assistance without mutating approval, token, or decision state", async () => {
    const decision = await replay("production_deploy");
    const provider = new CapturingProvider(
      JSON.stringify({
        summary: "Pending production deploy approval needs human review.",
        severity: "high",
        risk_notes: ["Production deploy remains deterministic REQUIRE_APPROVAL."],
        missing_evidence: [],
        suggested_actions: ["Verify rollback plan and staging deploy evidence."],
        failure_cause: null,
        approver_notes: "Check CI, tests, rollback plan, staging deployment, and requested service scope."
      })
    );
    const app = await createApp({ prisma, logger: false, aiProvider: provider, aiConfig: enabledConfig });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/ai-analysis`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().ai_analysis.approver_notes).toContain("Check CI");
    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: { approvalRequest: true, executionTokens: true }
    });
    expect(run.decision).toBe("REQUIRE_APPROVAL");
    expect(run.status).toBe("approval_pending");
    expect(run.approvalRequest?.status).toBe("pending");
    expect(run.approvalRequest?.approvalReadiness).toBe("collecting");
    expect(run.executionTokens).toHaveLength(0);

    await app.close();
  });

  it("generates failure analysis for failed executions", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("production_deploy");
    const approval = await approveDecision(decision);
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
    const token = await app.inject({
      method: "POST",
      url: "/api/v1/execution-tokens",
      payload: {
        skill_run_id: decision.run_id,
        approval_id: approval.id
      }
    });
    expect(token.statusCode).toBe(201);
    const tokenId = token.json().execution_token.execution_token_id as string;
    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: tokenId,
        idempotency_key: `ai-failure-${decision.run_id}`
      }
    });
    expect(queued.statusCode).toBe(202);
    await processQueuedRunById({ prisma, runId: decision.run_id });

    const provider = new CapturingProvider(
      JSON.stringify({
        summary: "Execution failed during rollout simulation.",
        severity: "high",
        risk_notes: ["Failure was captured after execution started."],
        missing_evidence: [],
        suggested_actions: ["Review deployment connector output and retry only after approval remains valid."],
        failure_cause: "Deployment simulation failed during rollout.",
        approver_notes: null
      })
    );
    const result = await generateRunAnalysis({
      prisma,
      runId: decision.run_id,
      provider,
      config: enabledConfig
    });

    expect(result.status).toBe(201);
    expect(result.body.ai_analysis.failure_cause).toContain("rollout");
    expect(provider.calls[0]?.user).toContain("failure_analysis");

    await app.close();
  });

  it("performs no external calls when AI is disabled", async () => {
    const decision = await replay("safe_tests");
    const provider = new CapturingProvider();
    const result = await generateRunAnalysis({
      prisma,
      runId: decision.run_id,
      provider,
      config: disabledConfig
    });

    expect(result.status).toBe(200);
    expect(result.body.ai_analysis.status).toBe("disabled");
    expect(provider.calls).toHaveLength(0);
  });

  it("generates an advisory audit trace summary endpoint without changing trace events", async () => {
    const decision = await replay("safe_tests");
    const beforeEvents = await prisma.auditEvent.count({
      where: { traceId: decision.trace_id }
    });
    const provider = new CapturingProvider();
    const app = await createApp({ prisma, logger: false, aiProvider: provider, aiConfig: enabledConfig });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/audit/${decision.trace_id}/ai-summary`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().ai_analysis.trace_id).toBe(decision.trace_id);
    await expect(
      prisma.auditEvent.count({
        where: { traceId: decision.trace_id }
      })
    ).resolves.toBe(beforeEvents);

    await app.close();
  });

  it("cascades AiRunAnalysis when a local SkillRun is deleted", async () => {
    const decision = await replay("safe_tests");
    const provider = new CapturingProvider();
    const result = await generateRunAnalysis({
      prisma,
      runId: decision.run_id,
      provider,
      config: enabledConfig
    });
    expect(result.status).toBe(201);
    const analysisId = result.body.ai_analysis.id as string;

    await prisma.skillRun.delete({ where: { id: decision.run_id } });
    await expect(prisma.aiRunAnalysis.findUnique({ where: { id: analysisId } })).resolves.toBeNull();
  });
});
