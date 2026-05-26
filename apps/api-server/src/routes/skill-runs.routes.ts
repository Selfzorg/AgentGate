import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { runDryRun } from "../services/dry-run-service";
import { queueSkillRunExecution } from "../services/execution-service";

const runParamsSchema = z.object({
  run_id: z.string()
});

const executeBodySchema = z.object({
  execution_token_id: z.string().optional(),
  idempotency_key: z.string().min(1)
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
        executionLogs: {
          orderBy: { sequence: "asc" },
          take: 100
        },
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
      idempotencyKey: body.idempotency_key,
      requestedBy: "agentgate-ui"
    });

    return reply.code(result.status).send(result.body);
  });
};
