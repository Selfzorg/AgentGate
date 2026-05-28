import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadDemoFixtures } from "@agentgate/config-loader";
import type { AiProvider, AiProviderConfig, AiProviderRequest, AiProviderResult } from "@agentgate/ai-provider";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService, type DecisionServiceResult } from "../apps/api-server/src/services/decision-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
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

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Demo readiness QA tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

class FailingProvider implements AiProvider {
  calls: AiProviderRequest[] = [];

  async completeJson(request: AiProviderRequest): Promise<AiProviderResult> {
    this.calls.push(request);
    throw new Error("demo QA provider unavailable");
  }
}

class EchoingProvider implements AiProvider {
  calls: AiProviderRequest[] = [];

  constructor(private readonly content: string) {}

  async completeJson(request: AiProviderRequest): Promise<AiProviderResult> {
    this.calls.push(request);
    return {
      content: this.content,
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120
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
    agentId: "demo_readiness_evidence_worker"
  });
}

async function approveDecision(decision: DecisionServiceResult, comment = "Demo QA approval evidence reviewed.") {
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
  expect(response.statusCode).toBe(201);
  return response.json() as {
    execution_token: {
      execution_token_id: string;
      status: string;
      scopes: string[];
    };
  };
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory() && ["node_modules", ".next"].includes(entry.name)) return Promise.resolve([]);
      return entry.isDirectory() ? collectFiles(fullPath) : Promise.resolve([fullPath]);
    })
  );
  return files.flat();
}

describe("home demo readiness QA", () => {
  it("keeps run, approval, and audit APIs available after AI provider failure", async () => {
    const decision = await replay("production_deploy");
    const provider = new FailingProvider();
    const app = await createApp({ prisma, logger: false, aiProvider: provider, aiConfig: enabledConfig });

    const analysis = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/ai-analysis`
    });
    expect(analysis.statusCode).toBe(200);
    expect(analysis.json().ai_analysis.status).toBe("failed");
    expect(provider.calls).toHaveLength(1);

    const runDetail = await app.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${decision.run_id}`
    });
    const approvals = await app.inject({
      method: "GET",
      url: "/api/v1/approvals"
    });
    const auditEvents = await app.inject({
      method: "GET",
      url: `/api/v1/audit-events?trace_id=${decision.trace_id}`
    });
    const auditIntegrity = await app.inject({
      method: "GET",
      url: `/api/v1/audit-integrity?trace_id=${decision.trace_id}`
    });

    expect(runDetail.statusCode).toBe(200);
    expect(runDetail.json().skill_run.ai_analysis.status).toBe("failed");
    expect(approvals.statusCode).toBe(200);
    const approvalsBody = approvals.json();
    expect(approvalsBody.approvals.length).toBeLessThanOrEqual(25);
    expect(approvalsBody.pagination).toMatchObject({
      limit: 25,
      offset: 0
    });
    expect(auditEvents.statusCode).toBe(200);
    expect(auditIntegrity.statusCode).toBe(200);

    await app.close();
  });

  it("keeps the approval queue paginated for dashboard performance", async () => {
    const decision = await replay("production_deploy");
    const app = await createApp({ prisma, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/approvals?limit=5"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.approvals.length).toBeLessThanOrEqual(5);
    expect(body.pagination.limit).toBe(5);
    expect(body.pagination.offset).toBe(0);
    expect(body.pagination.total).toBeGreaterThanOrEqual(body.approvals.length);

    const search = await app.inject({
      method: "GET",
      url: `/api/v1/approvals?limit=5&q=${encodeURIComponent(decision.run_id)}`
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json();
    expect(searchBody.approvals.map((approval: { skill_run: { id: string } }) => approval.skill_run.id)).toContain(decision.run_id);

    await app.close();
  });

  it("does not allow approval to bypass missing required checks", async () => {
    const decision = await replay("production_deploy");
    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { skillRunId: decision.run_id }
    });
    await prisma.gateCheckResult.updateMany({
      where: {
        skillRunId: decision.run_id,
        checkKey: "ci_passed"
      },
      data: {
        status: "missing"
      }
    });
    const app = await createApp({ prisma, logger: false });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/approve`,
      payload: {
        comment: "This should not bypass a missing required check."
      }
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe("Approval is blocked by missing checks");
    expect(body.missing_checks).toContain("ci_passed");

    const run = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id },
      include: { approvalRequest: true, auditEvents: true }
    });
    expect(run.status).toBe("approval_pending");
    expect(run.approvalRequest?.status).toBe("pending");
    expect(run.auditEvents.map((event) => event.eventType)).not.toContain("approval.granted");

    await app.close();
  });

  it("keeps UI-facing run, logs, audit, and AI analysis responses free of raw token material", async () => {
    const app = await createApp({ prisma, logger: false });
    const { decision, approval } = await approvedProductionDeploy();
    const token = await issueToken(app, decision.run_id, approval.id);
    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/execute`,
      payload: {
        execution_token_id: token.execution_token.execution_token_id,
        idempotency_key: `demo-qa-token-visibility-${decision.run_id}`
      }
    });
    expect(queued.statusCode).toBe(202);
    await processQueuedRunById({ prisma, runId: decision.run_id });

    const storedToken = await prisma.executionToken.findUniqueOrThrow({
      where: { id: token.execution_token.execution_token_id }
    });
    const syntheticRawToken = "agentgate-raw-token-should-never-render";
    const currentRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: decision.run_id }
    });
    await prisma.skillRun.update({
      where: { id: decision.run_id },
      data: {
        context: {
          ...(currentRun.context as Record<string, unknown>),
          active_execution_token: syntheticRawToken
        }
      }
    });
    const provider = new EchoingProvider(
      JSON.stringify({
        summary: `Do not persist ${storedToken.tokenHash} ${token.execution_token.execution_token_id} ${syntheticRawToken}`,
        severity: "medium",
        risk_notes: [`Authorization: Bearer ${syntheticRawToken}`],
        missing_evidence: [],
        suggested_actions: [`Review secret=${syntheticRawToken}`],
        failure_cause: null,
        approver_notes: null
      })
    );
    const aiApp = await createApp({ prisma, logger: false, aiProvider: provider, aiConfig: enabledConfig });
    const analysis = await aiApp.inject({
      method: "POST",
      url: `/api/v1/skill-runs/${decision.run_id}/ai-analysis`
    });
    expect(analysis.statusCode).toBe(201);

    const detail = await aiApp.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${decision.run_id}`
    });
    const logs = await aiApp.inject({
      method: "GET",
      url: `/api/v1/skill-runs/${decision.run_id}/logs`,
      headers: {
        "last-event-id": "0"
      }
    });
    const audit = await aiApp.inject({
      method: "GET",
      url: `/api/v1/audit-events?trace_id=${decision.trace_id}`
    });

    for (const body of [detail.body, logs.body, audit.body, analysis.body]) {
      expect(body).not.toContain("tokenHash");
      expect(body).not.toContain("token_hash");
      expect(body).not.toContain("raw_token");
      expect(body).not.toContain(storedToken.tokenHash);
      expect(body).not.toContain(syntheticRawToken);
    }
    expect(analysis.body).not.toContain(token.execution_token.execution_token_id);

    await aiApp.close();
    await app.close();
  });

  it("keeps demo UI wired to fixtures/API state with one AI insights card", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const launcherSource = await readFile(
      join(process.cwd(), "apps/web-dashboard/components/demo/DemoActionLauncher.tsx"),
      "utf8"
    );
    const riskScannerSource = await readFile(
      join(process.cwd(), "apps/web-dashboard/components/risk-scanner/RiskScannerPanel.tsx"),
      "utf8"
    );
    const liveSource = await readFile(
      join(process.cwd(), "apps/web-dashboard/components/live/LiveActivityTable.tsx"),
      "utf8"
    );
    const skillRunPage = await readFile(
      join(process.cwd(), "apps/web-dashboard/app/skill-runs/[runId]/page.tsx"),
      "utf8"
    );
    const aiFiles = (await collectFiles(join(process.cwd(), "apps/web-dashboard"))).filter((file) =>
      file.endsWith(".tsx")
    );
    const aiCardReferences = await Promise.all(
      aiFiles.map(async (file) => ({
        file,
        content: await readFile(file, "utf8")
      }))
    );

    expect(launcherSource).toContain("getDemoActions");
    expect(riskScannerSource).toContain("getRiskScannerSamples");
    expect(liveSource).toContain("href={`/skill-runs/${activity.run_id}`}");
    expect(skillRunPage).toContain("<AiInsightsEngine runId={runId} />");
    for (const action of fixtures.actions.actions) {
      expect(launcherSource).not.toContain(`"${action.id}"`);
      expect(launcherSource).not.toContain(`'${action.id}'`);
      expect(riskScannerSource).not.toContain(`"${action.id}"`);
      expect(riskScannerSource).not.toContain(`'${action.id}'`);
    }

    const aiComponentUsages = aiCardReferences
      .filter(({ content }) => content.includes("<AiInsightsEngine"))
      .map(({ file }) => file.replace(process.cwd(), ""));
    expect(aiComponentUsages).toEqual(["/apps/web-dashboard/app/skill-runs/[runId]/page.tsx"]);
  });

  it("does not add Redis, BullMQ, Kafka, NATS, RabbitMQ, or frontend-only fake execution", async () => {
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
      for (const forbidden of ["redis", "ioredis", "bullmq", "kafkajs", "nats", "amqplib"]) {
        expect(names).not.toContain(forbidden);
      }
    }

    const webSources = await Promise.all(
      (await collectFiles(join(process.cwd(), "apps/web-dashboard")))
        .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
        .map((file) => readFile(file, "utf8"))
    );
    const joinedSources = webSources.join("\n");
    expect(joinedSources).not.toContain("setStatus(\"completed\")");
    expect(joinedSources).not.toContain("fake execution");
    expect(joinedSources).not.toContain("mock execution");
    expect(joinedSources).toContain("executeSkillRun");
    expect(joinedSources).toContain("getSkillRunLogsUrl");
  });
});
