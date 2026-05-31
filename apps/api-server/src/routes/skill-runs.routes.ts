import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { serializeAnalysis } from "../services/ai-run-analysis-service";
import { completeClaudeHandoff } from "../services/claude-handoff-completion-service";
import { continueClaudeHandoff, createClaudeHandoff } from "../services/claude-handoff-service";
import { runDryRun } from "../services/dry-run-service";
import {
  claimExecutionLease,
  completeExecutionLease,
  heartbeatExecutionLease
} from "../services/execution-lease-service";
import { queueSkillRunExecution } from "../services/execution-service";

const runParamsSchema = z.object({
  run_id: z.string()
});

const skillRunStatuses = [
  "requested",
  "classified",
  "policy_evaluated",
  "dry_run_required",
  "dry_run_running",
  "dry_run_completed",
  "approval_required",
  "approval_pending",
  "approved",
  "denied",
  "credential_issued",
  "execution_queued",
  "executing",
  "completed",
  "failed",
  "rolled_back",
  "audited"
] as const;

const decisions = ["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"] as const;
const riskLevels = ["low", "medium", "high", "critical"] as const;
const environments = ["dev", "staging", "production"] as const;

const skillRunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().optional(),
  decision: z.string().trim().optional(),
  risk_level: z.string().trim().optional(),
  skill_id: z.string().trim().optional(),
  trace_id: z.string().trim().optional(),
  environment: z.string().trim().optional()
});

const executeBodySchema = z.object({
  execution_token_id: z.string().optional(),
  execution_token: z.string().min(1).optional(),
  idempotency_key: z.string().min(1)
});

const claudeHandoffBodySchema = z
  .object({
    requested_by: z.string().min(1).optional(),
    ttl_seconds: z.number().int().positive().optional(),
    api_base_url: z.string().url().optional()
  })
  .default({});

const claudeContinueBodySchema = z.object({
  execution_token: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
  requested_by: z.string().min(1).optional(),
  api_base_url: z.string().url().optional()
});

const claudeCompleteBodySchema = z.object({
  status: z.enum(["completed", "failed"]),
  summary: z.string().min(1).optional(),
  error: z.record(z.unknown()).optional(),
  requested_by: z.string().min(1).optional()
});

const leaseClaimBodySchema = z.object({
  runner_id: z.string().min(1),
  lease_seconds: z.number().int().positive().max(900).optional()
});

const leaseCompleteBodySchema = z.object({
  runner_id: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  result: z.record(z.unknown()).optional(),
  error: z.record(z.unknown()).optional()
});

export const registerSkillRunsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/skill-runs", async (request) => {
    const query = skillRunListQuerySchema.parse(request.query);
    const where = skillRunWhere(query);
    const runs = await app.services.prisma.skillRun.findMany({
      where,
      include: {
        agent: true,
        skill: true,
        matchedPolicy: true,
        approvalRequest: true,
        auditEvents: {
          orderBy: { createdAt: "desc" },
          take: 1
        },
        gateCheckResults: {
          select: {
            id: true,
            status: true,
            checkKey: true
          }
        },
        _count: {
          select: {
            gateCheckResults: true,
            evidenceTasks: true,
            executionLogs: true,
            auditEvents: true,
            executionTokens: true,
            skillRunAttempts: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    return {
      skill_runs: runs.map((run) => ({
        id: run.id,
        trace_id: run.traceId,
        created_at: run.createdAt.toISOString(),
        updated_at: run.updatedAt.toISOString(),
        agent: run.agent
          ? {
              id: run.agent.externalAgentId,
              role: run.agent.role,
              display_name: run.agent.displayName
            }
          : null,
        source: run.source,
        adapter_type: run.adapterType,
        raw_action: run.rawAction,
        skill_id: run.skill?.skillId ?? null,
        environment: run.environment,
        risk_level: run.riskLevel,
        risk_score: run.riskScore,
        decision: run.decision,
        status: run.status,
        reason: run.reason,
        matched_policy_id: run.matchedPolicy?.policyId ?? null,
        approval: run.approvalRequest
          ? {
              id: run.approvalRequest.id,
              status: run.approvalRequest.status,
              approval_readiness: run.approvalRequest.approvalReadiness,
              updated_at: run.approvalRequest.updatedAt.toISOString()
            }
          : null,
        counts: {
          approvals: run.approvalRequest ? 1 : 0,
          gate_checks: run._count.gateCheckResults,
          evidence_tasks: run._count.evidenceTasks,
          execution_logs: run._count.executionLogs,
          audit_events: run._count.auditEvents,
          execution_tokens: run._count.executionTokens,
          attempts: run._count.skillRunAttempts
        },
        gate_check_summary: summarizeGateChecks(run.gateCheckResults),
        no_gate_check_reason: run._count.gateCheckResults === 0 ? noGateCheckReason(run) : null,
        latest_audit_event: run.auditEvents[0]
          ? {
              id: run.auditEvents[0].id,
              event_type: run.auditEvents[0].eventType,
              sequence: run.auditEvents[0].sequence,
              created_at: run.auditEvents[0].createdAt.toISOString()
            }
          : null,
        next_action: nextActionForRun(run)
      }))
    };
  });

  app.get("/skill-runs/:run_id", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const run = await app.services.prisma.skillRun.findUnique({
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
          orderBy: { createdAt: "desc" }
        },
        skillRunAttempts: {
          orderBy: { createdAt: "desc" }
        },
        evidenceTasks: {
          orderBy: [{ createdAt: "desc" }]
        },
        executionLogs: {
          orderBy: { sequence: "asc" },
          take: 100
        },
        aiRunAnalysis: true,
        auditEvents: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!run) {
      return reply.code(404).send({ error: "Skill run not found" });
    }

    return {
      skill_run: {
        id: run.id,
        trace_id: run.traceId,
        raw_action: run.rawAction,
        source: run.source,
        adapter_type: run.adapterType,
        environment: run.environment,
        decision: run.decision,
        risk_level: run.riskLevel,
        risk_score: run.riskScore,
        risk_reasons: run.riskReasons,
        status: run.status,
        reason: run.reason,
        resolved_skill: run.resolvedSkillSnapshot,
        policy: run.policySnapshot,
        agent: run.agent,
        skill: run.skill,
        matched_policy: run.matchedPolicy,
        approval_request: run.approvalRequest,
        dry_run_result: run.dryRunResult,
        gate_checks: run.gateCheckResults.map((check) => ({
          id: check.id,
          check_key: check.checkKey,
          label: check.label,
          status: check.status,
          evidence: check.evidence
        })),
        evidence_tasks: run.evidenceTasks.map((task) => ({
          id: task.id,
          check_key: task.checkKey,
          status: task.status,
          runtime: task.runtime,
          attempt: task.attempt,
          claimed_by_agent_id: task.claimedByAgentId,
          lease_expires_at: task.leaseExpiresAt?.toISOString() ?? null,
          completed_at: task.completedAt?.toISOString() ?? null,
          created_at: task.createdAt.toISOString()
        })),
        execution_tokens: run.executionTokens.map((token) => ({
          id: token.id,
          status: token.status,
          scopes: token.scopes,
          environment: token.environment,
          approval_request_id: token.approvalRequestId,
          expires_at: token.expiresAt.toISOString(),
          used_at: token.usedAt?.toISOString() ?? null,
          revoked_at: token.revokedAt?.toISOString() ?? null,
          created_at: token.createdAt.toISOString()
        })),
        attempts: run.skillRunAttempts.map((attempt) => ({
          id: attempt.id,
          execution_token_id: attempt.executionTokenId,
          idempotency_key: attempt.idempotencyKey,
          status: attempt.status,
          claimed_by_runner_id: attempt.claimedByRunnerId,
          lease_expires_at: attempt.leaseExpiresAt?.toISOString() ?? null,
          heartbeat_at: attempt.heartbeatAt?.toISOString() ?? null,
          result: attempt.result,
          error: attempt.error,
          started_at: attempt.startedAt?.toISOString() ?? null,
          completed_at: attempt.completedAt?.toISOString() ?? null,
          created_at: attempt.createdAt.toISOString()
        })),
        execution_logs: run.executionLogs.map((log) => ({
          id: log.id,
          sequence: log.sequence,
          level: log.level,
          message: log.message,
          metadata: log.metadata,
          created_at: log.createdAt.toISOString()
        })),
        ai_analysis: run.aiRunAnalysis ? serializeAnalysis(run.aiRunAnalysis) : null,
        audit_events: run.auditEvents.map((event) => ({
          id: event.id,
          event_type: event.eventType,
          actor_type: event.actorType,
          actor_id: event.actorId,
          sequence: event.sequence,
          metadata: event.metadata,
          created_at: event.createdAt.toISOString()
        }))
      }
    };
  });

  app.post("/skill-runs/:run_id/dry-run", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const result = await runDryRun({
      prisma: app.services.prisma,
      runId
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/execute", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = executeBodySchema.parse(request.body);
    const result = await queueSkillRunExecution(app.services.prisma, {
      runId,
      executionTokenId: body.execution_token_id,
      executionToken: body.execution_token,
      idempotencyKey: body.idempotency_key,
      requestedBy: "agentgate-ui"
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/claude-handoff", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = claudeHandoffBodySchema.parse(request.body ?? {});
    const result = await createClaudeHandoff(app.services.prisma, {
      runId,
      requestedBy: body.requested_by,
      ttlSeconds: body.ttl_seconds,
      apiBaseUrl: body.api_base_url
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/claude-handoff/continue", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = claudeContinueBodySchema.parse(request.body);
    const result = await continueClaudeHandoff(app.services.prisma, {
      runId,
      executionToken: body.execution_token,
      idempotencyKey: body.idempotency_key,
      requestedBy: body.requested_by,
      apiBaseUrl: body.api_base_url
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/claude-handoff/complete", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = claudeCompleteBodySchema.parse(request.body);
    const result = await completeClaudeHandoff(app.services.prisma, {
      runId,
      status: body.status,
      summary: body.summary,
      error: body.error,
      requestedBy: body.requested_by
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/retry", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = executeBodySchema.parse(request.body);
    const result = await queueSkillRunExecution(app.services.prisma, {
      runId,
      executionTokenId: body.execution_token_id,
      executionToken: body.execution_token,
      idempotencyKey: body.idempotency_key,
      requestedBy: "agentgate-ui",
      allowRetry: true
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/execution-lease/claim", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = leaseClaimBodySchema.parse(request.body);
    const result = await claimExecutionLease(app.services.prisma, {
      runId,
      runnerId: body.runner_id,
      leaseSeconds: body.lease_seconds
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/execution-lease/heartbeat", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = leaseClaimBodySchema.parse(request.body);
    const result = await heartbeatExecutionLease(app.services.prisma, {
      runId,
      runnerId: body.runner_id,
      leaseSeconds: body.lease_seconds
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/skill-runs/:run_id/execution-lease/complete", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const body = leaseCompleteBodySchema.parse(request.body);
    const result = await completeExecutionLease(app.services.prisma, {
      runId,
      runnerId: body.runner_id,
      status: body.status,
      result: body.result,
      error: body.error
    });
    return reply.code(result.status).send(result.body);
  });
};

function skillRunWhere(query: z.infer<typeof skillRunListQuerySchema>): Prisma.SkillRunWhereInput {
  const and: Prisma.SkillRunWhereInput[] = [];
  if (query.q) and.push({ OR: searchConditions(query.q) });
  if (query.trace_id) and.push({ traceId: { contains: query.trace_id, mode: "insensitive" } });
  if (query.skill_id) {
    and.push({
      skill: {
        is: {
          OR: [
            { skillId: { contains: query.skill_id, mode: "insensitive" } },
            { name: { contains: query.skill_id, mode: "insensitive" } }
          ]
        }
      }
    });
  }
  addEnumFilter(and, "status", query.status, skillRunStatuses);
  addEnumFilter(and, "decision", query.decision?.toUpperCase(), decisions);
  addEnumFilter(and, "riskLevel", query.risk_level?.toLowerCase(), riskLevels);
  addEnumFilter(and, "environment", query.environment?.toLowerCase(), environments);

  return and.length > 0 ? { AND: and } : {};
}

function searchConditions(search: string): Prisma.SkillRunWhereInput[] {
  const conditions: Prisma.SkillRunWhereInput[] = [
    { id: { contains: search, mode: "insensitive" } },
    { traceId: { contains: search, mode: "insensitive" } },
    { rawAction: { contains: search, mode: "insensitive" } },
    {
      skill: {
        is: {
          OR: [
            { skillId: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } }
          ]
        }
      }
    }
  ];
  const lower = search.toLowerCase();
  const upper = search.toUpperCase();
  if (includesValue(skillRunStatuses, lower)) conditions.push({ status: lower });
  if (includesValue(decisions, upper)) conditions.push({ decision: upper });
  if (includesValue(riskLevels, lower)) conditions.push({ riskLevel: lower });
  if (includesValue(environments, lower)) conditions.push({ environment: lower });
  return conditions;
}

function addEnumFilter<T extends readonly string[]>(
  and: Prisma.SkillRunWhereInput[],
  field: "status" | "decision" | "riskLevel" | "environment",
  value: string | undefined,
  allowed: T
) {
  if (!value) return;
  if (!includesValue(allowed, value)) {
    and.push({ id: "__agentgate_no_matching_filter_value__" });
    return;
  }
  and.push({ [field]: value } as Prisma.SkillRunWhereInput);
}

function includesValue<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

function summarizeGateChecks(checks: Array<{ status: string; checkKey: string }>) {
  const summary = {
    total: checks.length,
    passed: 0,
    running: 0,
    pending: 0,
    missing: 0,
    failed: 0,
    unknown: 0
  };
  for (const check of checks) {
    if (check.status in summary) {
      summary[check.status as keyof typeof summary] += 1;
    }
  }
  return summary;
}

function noGateCheckReason(run: {
  skill: { skillId: string; name: string } | null;
  resolvedSkillSnapshot: unknown;
  policySnapshot: unknown;
  decision: string | null;
}) {
  const snapshot = recordFrom(run.resolvedSkillSnapshot);
  const policy = recordFrom(run.policySnapshot);
  const evidenceTasks = arrayFrom(snapshot.evidence_tasks);
  const requiredChecks = arrayFrom(policy.required_checks ?? policy.required_evidence);
  const resolverSource = stringFrom(snapshot.resolver_source);
  if (!run.skill || stringFrom(snapshot.skill_id) === "unknown" || resolverSource === "static_fallback") {
    return "No gate checks were created because the action resolved through the fallback path instead of an imported skill with evidence.";
  }
  if (requiredChecks.length === 0 && evidenceTasks.length === 0) {
    return "No policy-required checks or imported skill evidence tasks matched this run.";
  }
  if (run.decision === "ALLOW") {
    return "This run was allowed without approval, so no gate checks were required.";
  }
  return "No gate checks were persisted for this run.";
}

function nextActionForRun(run: {
  status: string;
  decision: string | null;
  approvalRequest: { status: string; approvalReadiness: string } | null;
  gateCheckResults: Array<{ status: string }>;
  _count: { executionTokens: number; skillRunAttempts: number };
}) {
  if (run.status === "completed") return "Review logs and audit";
  if (run.status === "failed") return "Review failure logs";
  if (run.status === "denied" || run.approvalRequest?.status === "denied") return "Review denial audit";
  if (run.status === "dry_run_required" || run.decision === "FORCE_DRY_RUN") return "Start Dry-Run";
  if (run.approvalRequest?.status === "pending") {
    if (run.approvalRequest.approvalReadiness === "collecting") return "Wait for evidence";
    if (run.gateCheckResults.some((check) => check.status !== "passed")) return "Resolve gate checks";
    return "Approve request";
  }
  if (run.approvalRequest?.status === "approved" || run.status === "approved") {
    return run._count.executionTokens > 0 ? "Continue execution" : "Issue execution token";
  }
  if (run.status === "credential_issued") return "Queue execution";
  if (run.status === "execution_queued" || run.status === "executing") return "Watch logs";
  return "Open run";
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
