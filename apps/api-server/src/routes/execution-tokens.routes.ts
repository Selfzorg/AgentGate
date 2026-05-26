import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { issueExecutionToken } from "../services/execution-token-service";

const issueTokenBodySchema = z.object({
  skill_run_id: z.string().min(1),
  approval_id: z.string().min(1).optional(),
  requested_by: z.string().min(1).optional(),
  ttl_seconds: z.number().int().positive().optional()
});

export const registerExecutionTokenRoutes: FastifyPluginAsync = async (app) => {
  app.post("/execution-tokens", async (request, reply) => {
    const body = issueTokenBodySchema.parse(request.body);
    const result = await issueExecutionToken(app.services.prisma, {
      skillRunId: body.skill_run_id,
      approvalId: body.approval_id,
      requestedBy: body.requested_by,
      ttlSeconds: body.ttl_seconds
    });

    return reply.code(result.status).send(result.body);
  });
};
