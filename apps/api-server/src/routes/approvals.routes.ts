import type { FastifyPluginAsync } from "fastify";

export const registerApprovalsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/approvals", async () => ({ approvals: [] }));

  app.post("/approvals/:approval_id/approve", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 2 placeholder" })
  );

  app.post("/approvals/:approval_id/deny", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 2 placeholder" })
  );

  app.post("/approvals/:approval_id/force-dry-run", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 2 placeholder" })
  );
};
