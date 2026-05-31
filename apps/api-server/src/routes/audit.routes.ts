import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { validateAuditTrace } from "../services/audit-integrity-service";

const auditQuerySchema = z.object({
  trace_id: z.string().optional(),
  skill_run_id: z.string().optional(),
  event_type: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  newest_first: z.enum(["true", "false"]).optional()
});

const auditTraceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(200).optional(),
  run_id: z.string().trim().optional(),
  trace_id: z.string().trim().optional(),
  event_type: z.string().trim().max(120).optional()
});

export const registerAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/audit-events", async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const events = await app.services.prisma.auditEvent.findMany({
      where: auditEventWhere({
        traceId: query.trace_id,
        skillRunId: query.skill_run_id,
        eventType: query.event_type
      }),
      orderBy:
        query.newest_first === "true"
          ? [{ createdAt: "desc" }, { sequence: "desc" }]
          : [{ traceId: "asc" }, { createdAt: "asc" }],
      take: query.limit
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

  app.get("/audit-traces", async (request) => {
    const query = auditTraceQuerySchema.parse(request.query);
    const events = await app.services.prisma.auditEvent.findMany({
      where: auditEventWhere({
        traceId: query.trace_id,
        skillRunId: query.run_id,
        eventType: query.event_type,
        q: query.q
      }),
      include: {
        skillRun: {
          include: {
            skill: true
          }
        }
      },
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
      take: Math.min(query.limit * 20, 500)
    });

    const traceIds = [...new Set(events.map((event) => event.traceId))].slice(0, query.limit);
    const auditTraces = await Promise.all(
      traceIds.map(async (traceId) => {
        const traceEvents = events.filter((event) => event.traceId === traceId);
        const latest = traceEvents[0];
        const allTraceEvents = await app.services.prisma.auditEvent.findMany({
          where: { traceId },
          include: {
            skillRun: {
              include: {
                skill: true
              }
            }
          },
          orderBy: [{ createdAt: "asc" }, { sequence: "asc" }]
        });
        const run = allTraceEvents.find((event) => event.skillRun)?.skillRun ?? latest?.skillRun ?? null;
        const integrity = await validateAuditTrace(app.services.prisma, {
          traceId,
          skillRunId: run?.id
        });

        return {
          trace_id: traceId,
          skill_run_id: run?.id ?? latest?.skillRunId ?? null,
          event_count: allTraceEvents.length,
          event_types: [...new Set(allTraceEvents.map((event) => event.eventType))],
          first_event_at: allTraceEvents[0]?.createdAt.toISOString() ?? latest?.createdAt.toISOString() ?? null,
          latest_event_at:
            allTraceEvents[allTraceEvents.length - 1]?.createdAt.toISOString() ?? latest?.createdAt.toISOString() ?? null,
          latest_event: latest
            ? {
                id: latest.id,
                event_type: latest.eventType,
                actor_type: latest.actorType,
                actor_id: latest.actorId,
                sequence: latest.sequence,
                created_at: latest.createdAt.toISOString()
              }
            : null,
          lifecycle: integrity,
          run: run
            ? {
                id: run.id,
                raw_action: run.rawAction,
                status: run.status,
                decision: run.decision,
                risk_level: run.riskLevel,
                environment: run.environment,
                skill_id: run.skill?.skillId ?? null,
                skill_name: run.skill?.name ?? null
              }
            : null
        };
      })
    );

    return {
      audit_traces: auditTraces
    };
  });

  app.get("/audit-integrity", async (request, reply) => {
    const query = auditQuerySchema.parse(request.query);
    if (!query.trace_id && !query.skill_run_id) {
      return reply.code(400).send({
        error: "trace_id or skill_run_id is required"
      });
    }

    return {
      audit_integrity: await validateAuditTrace(app.services.prisma, {
        traceId: query.trace_id,
        skillRunId: query.skill_run_id
      })
    };
  });
};

function auditEventWhere(input: {
  traceId?: string | undefined;
  skillRunId?: string | undefined;
  eventType?: string | undefined;
  q?: string | undefined;
}): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [];
  if (input.traceId) and.push({ traceId: { contains: input.traceId, mode: "insensitive" } });
  if (input.skillRunId) and.push({ skillRunId: { contains: input.skillRunId, mode: "insensitive" } });
  if (input.eventType) and.push({ eventType: { contains: input.eventType, mode: "insensitive" } });
  if (input.q) {
    and.push({
      OR: [
        { traceId: { contains: input.q, mode: "insensitive" } },
        { skillRunId: { contains: input.q, mode: "insensitive" } },
        { eventType: { contains: input.q, mode: "insensitive" } },
        { actorId: { contains: input.q, mode: "insensitive" } },
        {
          skillRun: {
            is: {
              OR: [
                { id: { contains: input.q, mode: "insensitive" } },
                { rawAction: { contains: input.q, mode: "insensitive" } },
                {
                  skill: {
                    is: {
                      OR: [
                        { skillId: { contains: input.q, mode: "insensitive" } },
                        { name: { contains: input.q, mode: "insensitive" } }
                      ]
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    });
  }

  return and.length > 0 ? { AND: and } : {};
}
