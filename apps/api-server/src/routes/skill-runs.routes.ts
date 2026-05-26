import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const runParamsSchema = z.object({
  run_id: z.string()
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

  app.post("/skill-runs/:run_id/dry-run", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 2 placeholder" })
  );

  app.post("/skill-runs/:run_id/execute", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 3 placeholder" })
  );
};
