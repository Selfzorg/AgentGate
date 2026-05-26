import type { FastifyPluginAsync } from "fastify";

export const registerSseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live/activity", async () => ({ events: [] }));

  app.get("/skill-runs/:run_id/logs", async (_request, reply) =>
    reply.code(501).send({
      error: "Phase 0 placeholder",
      message: "DB-backed SSE logs start in Phase 3."
    })
  );
};
