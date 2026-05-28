import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  claimEvidenceTask,
  clearActiveEvidenceQueue,
  completeEvidenceTask,
  failEvidenceTask,
  getEvidenceTask,
  heartbeatEvidenceTask,
  listPendingEvidenceTasks,
  prioritizeEvidenceTask,
  processEvidenceTasksOnce
} from "../services/evidence-task-service";

const taskParamsSchema = z.object({
  task_id: z.string()
});

const listQuerySchema = z.object({
  tenant_id: z.string().optional(),
  workspace_id: z.string().optional(),
  skill_run_id: z.string().optional(),
  newest_first: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().positive().max(50).optional()
});

const claimBodySchema = z.object({
  agent_id: z.string().min(1),
  runtime: z.string().min(1),
  lease_seconds: z.number().int().positive().max(900).optional()
});

const heartbeatBodySchema = z.object({
  agent_id: z.string().min(1),
  lease_seconds: z.number().int().positive().max(900).optional()
});

const completeBodySchema = z.object({
  agent_id: z.string().min(1),
  status: z.enum(["passed", "failed", "missing"]),
  reason: z.string().min(1),
  evidence: z.record(z.unknown()).optional()
});

const failBodySchema = z.object({
  agent_id: z.string().min(1),
  reason: z.string().min(1),
  error: z.record(z.unknown()).optional()
});

const prioritizeBodySchema = z
  .object({
    priority: z.number().int().min(1).max(10_000).optional(),
    requested_by: z.string().min(1).optional()
  })
  .default({});

const clearActiveBodySchema = z
  .object({
    tenant_id: z.string().default("tenant_demo"),
    workspace_id: z.string().default("workspace_demo"),
    skill_run_id: z.string().optional(),
    requested_by: z.string().min(1).optional(),
    reason: z.string().min(1).optional()
  })
  .default({});

const processBodySchema = z
  .object({
    limit: z.number().int().positive().max(50).optional(),
    concurrency: z.number().int().positive().max(16).optional(),
    agent_id: z.string().optional(),
    skill_run_id: z.string().optional()
  })
  .default({});

export const registerEvidenceTasksRoutes: FastifyPluginAsync = async (app) => {
  app.get("/evidence-tasks", async (request) => {
    const query = listQuerySchema.parse(request.query);
    return {
      evidence_tasks: await listPendingEvidenceTasks({
        prisma: app.services.prisma,
        tenantId: query.tenant_id,
        workspaceId: query.workspace_id,
        skillRunId: query.skill_run_id,
        newestFirst: query.newest_first === "true",
        limit: query.limit
      })
    };
  });

  app.get("/evidence-tasks/:task_id", async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const result = await getEvidenceTask(app.services.prisma, params.task_id);
    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-tasks/:task_id/claim", async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = claimBodySchema.parse(request.body);
    const result = await claimEvidenceTask(app.services.prisma, {
      taskId: params.task_id,
      agentId: body.agent_id,
      runtime: body.runtime,
      leaseSeconds: body.lease_seconds
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-tasks/:task_id/prioritize", async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = prioritizeBodySchema.parse(request.body ?? {});
    const result = await prioritizeEvidenceTask(app.services.prisma, {
      taskId: params.task_id,
      priority: body.priority,
      requestedBy: body.requested_by
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-tasks/:task_id/heartbeat", async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = heartbeatBodySchema.parse(request.body);
    const result = await heartbeatEvidenceTask(app.services.prisma, {
      taskId: params.task_id,
      agentId: body.agent_id,
      leaseSeconds: body.lease_seconds
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-tasks/:task_id/complete", async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = completeBodySchema.parse(request.body);
    const result = await completeEvidenceTask(app.services.prisma, {
      taskId: params.task_id,
      agentId: body.agent_id,
      result: {
        status: body.status,
        reason: body.reason,
        evidence: body.evidence
      }
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-tasks/:task_id/fail", async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = failBodySchema.parse(request.body);
    const result = await failEvidenceTask(app.services.prisma, {
      taskId: params.task_id,
      agentId: body.agent_id,
      reason: body.reason,
      error: body.error
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-tasks/clear-active", async (request, reply) => {
    const body = clearActiveBodySchema.parse(request.body ?? {});
    const result = await clearActiveEvidenceQueue(app.services.prisma, {
      tenantId: body.tenant_id,
      workspaceId: body.workspace_id,
      skillRunId: body.skill_run_id,
      requestedBy: body.requested_by,
      reason: body.reason
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/evidence-tasks/process-local", async (request) => {
    const body = processBodySchema.parse(request.body ?? {});
    return {
      worker: await processEvidenceTasksOnce({
        prisma: app.services.prisma,
        limit: body.limit,
        concurrency: body.concurrency,
        agentId: body.agent_id,
        skillRunId: body.skill_run_id
      })
    };
  });
};
