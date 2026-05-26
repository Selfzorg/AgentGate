import type { FastifyPluginAsync } from "fastify";

export const registerExecutionTokenRoutes: FastifyPluginAsync = async (app) => {
  app.post("/execution-tokens", async (_request, reply) =>
    reply.code(501).send({
      error: "Phase 0 placeholder",
      message: "Token issuance starts in Phase 3. UI-facing responses will not expose raw token values."
    })
  );
};
