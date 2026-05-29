import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requestBreakGlass } from "../services/break-glass-service";
import { verifyAuditArtifacts } from "../services/audit-artifact-service";

const breakGlassBodySchema = z.object({
  run_id: z.string().min(1),
  actor_id: z.string().min(1).optional(),
  reason: z.string().optional(),
  severity: z.enum(["high", "critical"]).optional()
});

const auditArtifactVerifyQuerySchema = z.object({
  skill_run_id: z.string().optional(),
  audit_event_id: z.string().optional()
});

export const registerProductionReadinessRoutes: FastifyPluginAsync = async (app) => {
  app.post("/break-glass", async (request, reply) => {
    const body = breakGlassBodySchema.parse(request.body);
    const result = await requestBreakGlass(app.services.prisma, {
      runId: body.run_id,
      actorId: body.actor_id,
      reason: body.reason,
      severity: body.severity
    });

    return reply.code(result.status).send(result.body);
  });

  app.get("/audit-artifacts/verify", async (request) => {
    const query = auditArtifactVerifyQuerySchema.parse(request.query);
    return {
      audit_artifacts: await verifyAuditArtifacts(app.services.prisma, {
        skillRunId: query.skill_run_id,
        auditEventId: query.audit_event_id
      })
    };
  });
};
