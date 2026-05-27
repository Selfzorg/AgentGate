import {
  createAiProvider,
  estimateCostCents,
  estimateTokens,
  extractTransientExecutionTokens,
  parseAiRunAnalysisOutput,
  readAiProviderConfig,
  redactForAi,
  type AiProvider,
  type AiProviderConfig
} from "@agentgate/ai-provider";
import { Prisma, type PrismaClient, type SkillRunStatus } from "@prisma/client";
import { createId } from "./id";

const MAX_OUTPUT_TOKENS = 700;

export type GenerateRunAnalysisOptions = {
  prisma: PrismaClient;
  runId: string;
  provider?: AiProvider | undefined;
  config?: AiProviderConfig | undefined;
};

export async function generateRunAnalysis({
  prisma,
  runId,
  provider,
  config = readAiProviderConfig()
}: GenerateRunAnalysisOptions) {
  const run = await loadRunForAnalysis(prisma, runId);
  if (!run) return { status: 404 as const, body: { error: "Skill run not found" } };

  if (!config.enabled) {
    const analysis = await persistAnalysis(prisma, run, {
      summary: "AI Insights Engine is disabled. Set AI_ENABLED=true to generate advisory run intelligence.",
      severity: "info",
      riskNotes: [],
      missingEvidence: [],
      suggestedActions: ["Review deterministic governance state, approval evidence, logs, and audit trace."],
      failureCause: null,
      approverNotes: null,
      model: config.model,
      provider: config.provider,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCents: 0,
      status: "disabled",
      error: null
    });
    return { status: 200 as const, body: { ai_analysis: serializeAnalysis(analysis) } };
  }

  const payload = compileAnalysisPayload(run, config.maxInputTokens);
  const activeTokens = extractTransientExecutionTokens(run.context);
  const user = redactForAi({ value: payload, activeTokenStrings: activeTokens });
  const inputTokens = estimateTokens(user);
  const estimatedCost = estimateCostCents(inputTokens + MAX_OUTPUT_TOKENS);
  const spentToday = await aiSpendToday(prisma);

  if (spentToday + estimatedCost > config.dailyBudgetCents) {
    const analysis = await persistAnalysis(prisma, run, {
      summary: "AI Insights Engine skipped this request because the configured daily budget would be exceeded.",
      severity: "info",
      riskNotes: [],
      missingEvidence: [],
      suggestedActions: ["Raise AI_DAILY_BUDGET_CENTS or review the deterministic run detail manually."],
      failureCause: null,
      approverNotes: null,
      model: config.model,
      provider: config.provider,
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      estimatedCostCents: 0,
      status: "disabled",
      error: "AI daily budget guardrail prevented provider call."
    });
    return { status: 200 as const, body: { ai_analysis: serializeAnalysis(analysis) } };
  }

  try {
    const aiProvider = provider ?? createAiProvider(config);
    const response = await aiProvider.completeJson({
      system: systemPrompt(),
      user,
      maxOutputTokens: MAX_OUTPUT_TOKENS
    });
    const parsed = parseAiRunAnalysisOutput(response.content);
    const totalTokens = response.totalTokens ?? inputTokens + (response.outputTokens ?? estimateTokens(response.content));
    const analysis = await persistAnalysis(prisma, run, {
      summary: parsed.summary,
      severity: parsed.severity,
      riskNotes: parsed.risk_notes,
      missingEvidence: parsed.missing_evidence,
      suggestedActions: parsed.suggested_actions,
      failureCause: parsed.failure_cause,
      approverNotes: parsed.approver_notes,
      model: config.model,
      provider: config.provider,
      inputTokens: response.inputTokens ?? inputTokens,
      outputTokens: response.outputTokens ?? Math.max(0, totalTokens - inputTokens),
      totalTokens,
      estimatedCostCents: estimateCostCents(totalTokens),
      status: "completed",
      error: null
    });

    return { status: 201 as const, body: { ai_analysis: serializeAnalysis(analysis) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI analysis failed.";
    const analysis = await persistAnalysis(prisma, run, {
      summary: "AI analysis failed. Deterministic governance, approval, execution, and audit flows were not changed.",
      severity: "info",
      riskNotes: [],
      missingEvidence: [],
      suggestedActions: ["Use the persisted run detail and audit trace while the advisory provider is unavailable."],
      failureCause: run.status === "failed" ? "Provider failed before advisory failure cause could be generated." : null,
      approverNotes: run.approvalRequest?.status === "pending" ? "Provider failed before approval notes could be generated." : null,
      model: config.model,
      provider: config.provider,
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      estimatedCostCents: 0,
      status: "failed",
      error: message
    });

    return { status: 200 as const, body: { ai_analysis: serializeAnalysis(analysis) } };
  }
}

export async function getRunAnalysis(prisma: PrismaClient, runId: string) {
  const analysis = await prisma.aiRunAnalysis.findUnique({
    where: { skillRunId: runId }
  });

  if (!analysis) return { status: 404 as const, body: { error: "AI analysis not found" } };
  return { status: 200 as const, body: { ai_analysis: serializeAnalysis(analysis) } };
}

export async function generateTraceAnalysis(options: {
  prisma: PrismaClient;
  traceId: string;
  provider?: AiProvider | undefined;
  config?: AiProviderConfig | undefined;
}) {
  const run = await options.prisma.skillRun.findFirst({
    where: { traceId: options.traceId },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });

  if (!run) return { status: 404 as const, body: { error: "Skill run not found for trace" } };
  return generateRunAnalysis({
    prisma: options.prisma,
    runId: run.id,
    provider: options.provider,
    config: options.config
  });
}

export function serializeAnalysis(analysis: {
  id: string;
  skillRunId: string;
  traceId: string;
  summary: string;
  severity: string;
  riskNotes: Prisma.JsonValue;
  missingEvidence: Prisma.JsonValue;
  suggestedActions: Prisma.JsonValue;
  failureCause: string | null;
  approverNotes: string | null;
  model: string;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostCents: number;
  status: string;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: analysis.id,
    skill_run_id: analysis.skillRunId,
    trace_id: analysis.traceId,
    summary: analysis.summary,
    severity: analysis.severity,
    risk_notes: analysis.riskNotes,
    missing_evidence: analysis.missingEvidence,
    suggested_actions: analysis.suggestedActions,
    failure_cause: analysis.failureCause,
    approver_notes: analysis.approverNotes,
    model: analysis.model,
    provider: analysis.provider,
    input_tokens: analysis.inputTokens,
    output_tokens: analysis.outputTokens,
    total_tokens: analysis.totalTokens,
    estimated_cost_cents: analysis.estimatedCostCents,
    status: analysis.status,
    error: analysis.error,
    created_at: analysis.createdAt.toISOString(),
    updated_at: analysis.updatedAt.toISOString()
  };
}

type AnalysisRun = NonNullable<Awaited<ReturnType<typeof loadRunForAnalysis>>>;

async function loadRunForAnalysis(prisma: PrismaClient, runId: string) {
  return prisma.skillRun.findUnique({
    where: { id: runId },
    include: {
      agent: true,
      skill: true,
      matchedPolicy: true,
      gateCheckResults: {
        orderBy: { checkKey: "asc" }
      },
      approvalRequest: true,
      dryRunResult: true,
      executionTokens: {
        orderBy: { createdAt: "desc" }
      },
      executionLogs: {
        orderBy: { sequence: "asc" },
        take: 200
      },
      skillRunAttempts: {
        orderBy: { createdAt: "desc" }
      },
      auditEvents: {
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }]
      }
    }
  });
}

function compileAnalysisPayload(run: AnalysisRun, maxInputTokens: number) {
  const mode = analysisMode(run.status, run.approvalRequest?.status ?? null);
  const logSummary = summarizeLogs(run.executionLogs, maxInputTokens);

  return {
    instruction:
      "Generate advisory AI Run Intelligence only. Do not change or reinterpret deterministic AgentGate decisions.",
    mode,
    deterministic_decision: run.decision,
    final_status: run.status,
    skill_run: {
      id: run.id,
      trace_id: run.traceId,
      source: run.source,
      adapter_type: run.adapterType,
      raw_action: run.rawAction,
      environment: run.environment,
      risk_level: run.riskLevel,
      risk_score: run.riskScore,
      risk_reasons: run.riskReasons,
      reason: run.reason,
      resolved_skill: run.resolvedSkillSnapshot,
      matched_policy: run.policySnapshot
    },
    agent: run.agent
      ? {
          external_agent_id: run.agent.externalAgentId,
          role: run.agent.role,
          display_name: run.agent.displayName
        }
      : null,
    gate_checks: run.gateCheckResults.map((check) => ({
      check_key: check.checkKey,
      label: check.label,
      status: check.status,
      evidence: check.evidence
    })),
    approval_request: run.approvalRequest
      ? {
          status: run.approvalRequest.status,
          approval_readiness: run.approvalRequest.approvalReadiness,
          missing_checks: run.approvalRequest.missingChecks,
          required_approvers: run.approvalRequest.requiredApprovers,
          evidence: run.approvalRequest.evidence,
          comment: run.approvalRequest.comment
        }
      : null,
    dry_run_result: run.dryRunResult
      ? {
          status: run.dryRunResult.status,
          summary: run.dryRunResult.summary,
          result: run.dryRunResult.result,
          artifacts: run.dryRunResult.artifacts
        }
      : null,
    token_status_metadata: run.executionTokens.map((token) => ({
      status: token.status,
      scopes: token.scopes,
      environment: token.environment,
      expires_at: token.expiresAt.toISOString(),
      used_at: token.usedAt?.toISOString() ?? null,
      revoked_at: token.revokedAt?.toISOString() ?? null
    })),
    attempts: run.skillRunAttempts.map((attempt) => ({
      status: attempt.status,
      result: attempt.result,
      error: attempt.error,
      started_at: attempt.startedAt?.toISOString() ?? null,
      completed_at: attempt.completedAt?.toISOString() ?? null
    })),
    execution_logs: logSummary,
    audit_events: run.auditEvents.map((event) => ({
      event_type: event.eventType,
      actor_type: event.actorType,
      sequence: event.sequence,
      metadata: event.metadata,
      created_at: event.createdAt.toISOString()
    })),
    required_json_shape: {
      summary: "string",
      severity: "info | low | medium | high | critical",
      risk_notes: ["string"],
      missing_evidence: ["string"],
      suggested_actions: ["string"],
      failure_cause: "string|null",
      approver_notes: "string|null"
    }
  };
}

function summarizeLogs(logs: AnalysisRun["executionLogs"], maxInputTokens: number) {
  const serialized = JSON.stringify(logs);
  const maxChars = Math.max(2000, maxInputTokens * 3);
  if (serialized.length <= maxChars && logs.length <= 40) {
    return {
      total_logs: logs.length,
      locally_summarized: false,
      rows: logs.map((log) => ({
        sequence: log.sequence,
        level: log.level,
        message: log.message,
        metadata: log.metadata,
        created_at: log.createdAt.toISOString()
      }))
    };
  }

  const head = logs.slice(0, 8);
  const tail = logs.slice(-20);
  return {
    total_logs: logs.length,
    locally_summarized: true,
    omitted_middle_logs: Math.max(0, logs.length - head.length - tail.length),
    local_summary: [
      `Log buffer was capped before model call.`,
      `First sequence: ${logs[0]?.sequence ?? "none"}.`,
      `Last sequence: ${logs.at(-1)?.sequence ?? "none"}.`,
      `Error lines: ${logs.filter((log) => log.level === "error").length}.`
    ].join(" "),
    rows: [...head, ...tail].map((log) => ({
      sequence: log.sequence,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      created_at: log.createdAt.toISOString()
    }))
  };
}

function analysisMode(status: SkillRunStatus, approvalStatus: string | null) {
  if (approvalStatus === "pending") return "approval_assistant";
  if (status === "failed") return "failure_analysis";
  return "run_summary";
}

async function aiSpendToday(prisma: PrismaClient) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const aggregate = await prisma.aiRunAnalysis.aggregate({
    where: {
      createdAt: {
        gte: start
      }
    },
    _sum: {
      estimatedCostCents: true
    }
  });

  return aggregate._sum.estimatedCostCents ?? 0;
}

async function persistAnalysis(
  prisma: PrismaClient,
  run: AnalysisRun,
  data: {
    summary: string;
    severity: string;
    riskNotes: string[];
    missingEvidence: string[];
    suggestedActions: string[];
    failureCause: string | null;
    approverNotes: string | null;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostCents: number;
    status: "completed" | "failed" | "disabled";
    error: string | null;
  }
) {
  const write = {
    traceId: run.traceId,
    summary: data.summary,
    severity: data.severity,
    riskNotes: data.riskNotes as Prisma.InputJsonValue,
    missingEvidence: data.missingEvidence as Prisma.InputJsonValue,
    suggestedActions: data.suggestedActions as Prisma.InputJsonValue,
    failureCause: data.failureCause,
    approverNotes: data.approverNotes,
    model: data.model,
    provider: data.provider,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    totalTokens: data.totalTokens,
    estimatedCostCents: data.estimatedCostCents,
    status: data.status,
    error: data.error
  };

  return prisma.aiRunAnalysis.upsert({
    where: { skillRunId: run.id },
    create: {
      id: createId("ai_run"),
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      skillRunId: run.id,
      ...write
    },
    update: write
  });
}

function systemPrompt() {
  return [
    "You are AgentGate AI Run Intelligence.",
    "Your output is advisory only and must never approve, deny, force dry-run, issue tokens, execute, retry, or change policy decisions.",
    "Use only the provided persisted governance state, logs, and audit events.",
    "Return strict JSON only with keys: summary, severity, risk_notes, missing_evidence, suggested_actions, failure_cause, approver_notes.",
    "For approval_assistant mode, explain what the human should verify before acting.",
    "For failure_analysis mode, infer the likely failure cause from logs and audit sequence.",
    "Do not include secrets, token IDs, token hashes, API keys, or authorization headers."
  ].join(" ");
}
