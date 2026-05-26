import type { FastifyPluginAsync } from "fastify";

export const registerDecisionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/decision", async (_request, reply) =>
    reply.code(501).send({
      error: "Phase 0 placeholder",
      message: "Decision pipeline starts in Phase 1."
    })
  );
};
