import type { FastifyPluginAsync } from "fastify";

export const registerAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/audit-events", async () => ({ audit_events: [] }));
};
