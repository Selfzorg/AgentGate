import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const runParamsSchema = z.object({
  run_id: z.string()
});

const liveActivityQuerySchema = z.object({
  poll_ms: z.coerce.number().int().positive().max(5000).optional(),
  heartbeat_ms: z.coerce.number().int().positive().max(60000).optional(),
  once: z.enum(["true", "false"]).optional()
});

const logsQuerySchema = z.object({
  poll_ms: z.coerce.number().int().positive().max(5000).optional(),
  heartbeat_ms: z.coerce.number().int().positive().max(60000).optional()
});

const terminalStatuses = new Set(["completed", "failed", "denied", "rolled_back"]);

export const registerSseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live/activity", async (request, reply) => {
    if (acceptsEventStream(request.headers.accept)) {
      const query = liveActivityQuerySchema.parse(request.query);
      reply.hijack();
      reply.raw.writeHead(200, sseHeaders());

      let lastSeenTimestamp = parseLastEventTimestamp(request.headers["last-event-id"]);
      let closed = false;
      const pollMs = query.poll_ms ?? 500;
      const heartbeatMs = query.heartbeat_ms ?? 15000;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        reply.raw.end();
      };

      request.raw.on("close", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
      });

      const flush = async () => {
        if (closed) return;

        const rows = await recentActivities(app.services.prisma, {
          updatedAfter: lastSeenTimestamp ? new Date(lastSeenTimestamp) : undefined,
          take: 50
        });

        for (const row of rows.reverse()) {
          const eventId = String(new Date(row.updated_at).getTime());
          lastSeenTimestamp = Number(eventId);
          writeSseEvent(reply.raw, {
            event: "live_activity",
            id: eventId,
            data: row
          });
        }

        if (query.once === "true") close();
      };

      const pollTimer = setInterval(() => {
        void flush().catch((error) => {
          writeSseEvent(reply.raw, {
            event: "live_activity_error",
            data: {
              message: error instanceof Error ? error.message : "Failed to stream live activity"
            }
          });
          close();
        });
      }, pollMs);

      const heartbeatTimer = setInterval(() => {
        if (!closed) {
          writeSseEvent(reply.raw, {
            event: "heartbeat",
            data: {
              ts: new Date().toISOString()
            }
          });
        }
      }, heartbeatMs);

      await flush().catch(() => close());
      return;
    }

    const activities = await recentActivities(app.services.prisma);

    return {
      activities
    };
  });

  app.get("/skill-runs/:run_id/logs", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const query = logsQuerySchema.parse(request.query);
    const run = await app.services.prisma.skillRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true }
    });

    if (!run) {
      return reply.code(404).send({ error: "Skill run not found" });
    }

    reply.hijack();
    reply.raw.writeHead(200, sseHeaders());

    let lastSeenSequence = parseLastEventId(request.headers["last-event-id"]);
    let closed = false;
    const pollMs = query.poll_ms ?? 500;
    const heartbeatMs = query.heartbeat_ms ?? 15000;

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      reply.raw.end();
    };

    request.raw.on("close", () => {
      closed = true;
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
    });

    const flush = async () => {
      if (closed) return;

      const logs = await app.services.prisma.executionLog.findMany({
        where: {
          skillRunId: runId,
          sequence: {
            gt: lastSeenSequence
          }
        },
        orderBy: { sequence: "asc" }
      });

      for (const log of logs) {
        lastSeenSequence = log.sequence;
        writeSseEvent(reply.raw, {
          event: "execution_log",
          id: String(log.sequence),
          data: {
            sequence: log.sequence,
            level: log.level,
            message: log.message,
            metadata: log.metadata,
            created_at: log.createdAt.toISOString()
          }
        });
      }

      const currentRun = await app.services.prisma.skillRun.findUnique({
        where: { id: runId },
        select: { status: true }
      });

      if (currentRun && terminalStatuses.has(currentRun.status)) {
        writeSseEvent(reply.raw, {
          event: "execution_completed",
          id: "final",
          data: {
            run_id: runId,
            status: currentRun.status
          }
        });
        close();
      }
    };

    const pollTimer = setInterval(() => {
      void flush().catch((error) => {
        writeSseEvent(reply.raw, {
          event: "execution_error",
          data: {
            message: error instanceof Error ? error.message : "Failed to stream execution logs"
          }
        });
        close();
      });
    }, pollMs);

    const heartbeatTimer = setInterval(() => {
      if (!closed) {
        writeSseEvent(reply.raw, {
          event: "heartbeat",
          data: {
            ts: new Date().toISOString()
          }
        });
      }
    }, heartbeatMs);

    await flush().catch(() => close());
  });
};

async function recentActivities(
  prisma: PrismaClient,
  options: {
    updatedAfter?: Date | undefined;
    take?: number | undefined;
  } = {}
) {
  const where: Prisma.SkillRunWhereInput = options.updatedAfter
    ? {
        updatedAt: {
          gt: options.updatedAfter
        }
      }
    : {};

  const runs = await prisma.skillRun.findMany({
    where,
    include: {
      agent: true,
      skill: true,
      matchedPolicy: true,
      auditEvents: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 50
  });

  return runs.map((run) => ({
    time: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
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
    matched_policy_id: run.matchedPolicy?.policyId ?? null,
    latest_audit_event: run.auditEvents[0]
      ? {
          event_type: run.auditEvents[0].eventType,
          sequence: run.auditEvents[0].sequence,
          created_at: run.auditEvents[0].createdAt.toISOString()
        }
      : null
  }));
}

function parseLastEventId(header: string | string[] | undefined): number {
  const value = Array.isArray(header) ? header[0] : header;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseLastEventTimestamp(header: string | string[] | undefined): number | null {
  const parsed = parseLastEventId(header);
  return parsed > 0 ? parsed : null;
}

function acceptsEventStream(accept: string | string[] | undefined): boolean {
  const value = Array.isArray(accept) ? accept.join(",") : accept;
  return value?.includes("text/event-stream") ?? false;
}

function sseHeaders() {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
    "x-accel-buffering": "no"
  };
}

function writeSseEvent(
  stream: NodeJS.WritableStream,
  event: {
    event: string;
    id?: string;
    data: Record<string, unknown>;
  }
) {
  stream.write(`event: ${event.event}\n`);
  if (event.id) stream.write(`id: ${event.id}\n`);
  stream.write(`data: ${JSON.stringify(event.data)}\n\n`);
}
