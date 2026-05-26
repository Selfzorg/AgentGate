import type { FastifyPluginAsync } from "fastify";

export const registerSseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live/activity", async () => {
    const runs = await app.services.prisma.skillRun.findMany({
      include: {
        agent: true,
        skill: true,
        matchedPolicy: true
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return {
      activities: runs.map((run) => ({
        time: run.createdAt.toISOString(),
        run_id: run.id,
        trace_id: run.traceId,
        agent_id: run.agent?.externalAgentId ?? null,
        agent_display_name: run.agent?.displayName ?? run.agentId,
        role: run.agent?.role ?? null,
        source: run.source,
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

  app.get("/skill-runs/:run_id/logs", async (_request, reply) =>
    reply.code(501).send({
      error: "Phase 3 placeholder",
      message: "DB-backed SSE logs start in Phase 3."
    })
  );
};
