import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { serializeAnalysis } from "../services/ai-run-analysis-service";
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

const executeBodySchema = z.object({
  execution_token_id: z.string().optional(),
  execution_token: z.string().min(1).optional(),
  idempotency_key: z.string().min(1)
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
  app.get("/skill-runs", async () => {
    const runs = await app.services.prisma.skillRun.findMany({
      include: {
        agent: true,
        skill: true,
        matchedPolicy: true
      },
      orderBy: { createdAt: "desc" },
      take: 100
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
        matched_policy_id: run.matchedPolicy?.policyId ?? null
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
