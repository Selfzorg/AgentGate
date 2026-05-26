import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { approveRequest, denyRequest, getApprovalQueue } from "../services/approval-service";
import { runDryRun } from "../services/dry-run-service";

const approvalParamsSchema = z.object({
  approval_id: z.string()
});

const actionBodySchema = z
  .object({
    actor_id: z.string().optional(),
    comment: z.string().optional()
  })
  .default({});

export const registerApprovalsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/approvals", async () => ({
    approvals: await getApprovalQueue(app.services.prisma)
  }));

  app.post("/approvals/:approval_id/approve", async (request, reply) => {
    const params = approvalParamsSchema.parse(request.params);
    const body = actionBodySchema.parse(request.body ?? {});
    const input = {
      approvalId: params.approval_id,
      actorId: body.actor_id ?? "user_service_owner"
    };
    const result = await approveRequest(app.services.prisma, body.comment ? { ...input, comment: body.comment } : input);

    return reply.code(result.status).send(result.body);
  });

  app.post("/approvals/:approval_id/deny", async (request, reply) => {
    const params = approvalParamsSchema.parse(request.params);
    const body = actionBodySchema.parse(request.body ?? {});
    const input = {
      approvalId: params.approval_id,
      actorId: body.actor_id ?? "user_service_owner"
    };
    const result = await denyRequest(app.services.prisma, body.comment ? { ...input, comment: body.comment } : input);

    return reply.code(result.status).send(result.body);
  });

  app.post("/approvals/:approval_id/force-dry-run", async (request, reply) => {
    const params = approvalParamsSchema.parse(request.params);
    const approval = await app.services.prisma.approvalRequest.findUnique({
      where: { id: params.approval_id }
    });

    if (!approval) {
      return reply.code(404).send({ error: "Approval request not found" });
    }

    if (approval.status !== "pending") {
      return reply.code(409).send({ error: "Approval request is not pending" });
    }

    const result = await runDryRun({
      prisma: app.services.prisma,
      runId: approval.skillRunId,
      requestedBy: "user_service_owner"
    });

    return reply.code(result.status).send(result.body);
  });
};
