import type { FastifyPluginAsync } from "fastify";

export const registerMcpRoutes: FastifyPluginAsync = async (app) => {
  app.post("/mcp/invoke", async (_request, reply) =>
    reply.code(501).send({
      error: "Phase 0 placeholder",
      message: "MCP-compatible subset starts in Phase 1."
    })
  );
};
