import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const auditQuerySchema = z.object({
  trace_id: z.string().optional(),
  skill_run_id: z.string().optional()
});

export const registerAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/audit-events", async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const events = await app.services.prisma.auditEvent.findMany({
      where: {
        ...(query.trace_id ? { traceId: query.trace_id } : {}),
        ...(query.skill_run_id ? { skillRunId: query.skill_run_id } : {})
      },
      orderBy: [{ traceId: "asc" }, { createdAt: "asc" }]
    });

    return {
      audit_events: events.map((event) => ({
        id: event.id,
        tenant_id: event.tenantId,
        workspace_id: event.workspaceId,
        skill_run_id: event.skillRunId,
        trace_id: event.traceId,
        event_type: event.eventType,
        actor_type: event.actorType,
        actor_id: event.actorId,
        sequence: event.sequence,
        metadata: event.metadata,
        created_at: event.createdAt.toISOString()
      }))
    };
  });
};
