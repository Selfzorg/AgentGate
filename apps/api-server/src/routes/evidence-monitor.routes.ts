import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  getEvidenceMonitor,
  markEvidenceWorkerStopped,
  recordEvidenceWorkerHeartbeat
} from "../services/evidence-worker-service";

const monitorQuerySchema = z.object({
  tenant_id: z.string().default("tenant_demo"),
  workspace_id: z.string().default("workspace_demo"),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const workerParamsSchema = z.object({
  agent_id: z.string().min(1)
});

const workerHeartbeatBodySchema = z.object({
  tenant_id: z.string().default("tenant_demo"),
  workspace_id: z.string().default("workspace_demo"),
  agent_id: z.string().min(1),
  runtime: z.string().min(1),
  driver: z.string().min(1),
  status: z.enum(["online", "idle", "busy", "offline", "error"]),
  current_task_id: z.string().nullable().optional(),
  current_check_key: z.string().nullable().optional(),
  processed_delta: z.number().int().nonnegative().optional(),
  failed_delta: z.number().int().nonnegative().optional(),
  capabilities: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional()
});

const workerStopBodySchema = z
  .object({
    tenant_id: z.string().default("tenant_demo"),
    workspace_id: z.string().default("workspace_demo")
  })
  .default({});

export const registerEvidenceMonitorRoutes: FastifyPluginAsync = async (app) => {
  app.get("/evidence-monitor", async (request) => {
    const query = monitorQuerySchema.parse(request.query);
    return getEvidenceMonitor(app.services.prisma, {
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      limit: query.limit
    });
  });

  app.post("/evidence-workers/heartbeat", async (request, reply) => {
    const body = workerHeartbeatBodySchema.parse(request.body ?? {});
    const result = await recordEvidenceWorkerHeartbeat(app.services.prisma, {
      tenantId: body.tenant_id,
      workspaceId: body.workspace_id,
      agentId: body.agent_id,
      runtime: body.runtime,
      driver: body.driver,
      status: body.status,
      currentTaskId: body.current_task_id,
      currentCheckKey: body.current_check_key,
      processedDelta: body.processed_delta,
      failedDelta: body.failed_delta,
      capabilities: body.capabilities,
      metadata: body.metadata
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-workers/:agent_id/stop", async (request, reply) => {
    const params = workerParamsSchema.parse(request.params);
    const body = workerStopBodySchema.parse(request.body ?? {});
    const result = await markEvidenceWorkerStopped(app.services.prisma, {
      tenantId: body.tenant_id,
      workspaceId: body.workspace_id,
      agentId: params.agent_id
    });

    return reply.code(result.status).send(result.body);
  });
};
