import type { FastifyPluginAsync } from "fastify";

export const registerSkillRunsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/skill-runs", async () => ({ skill_runs: [] }));

  app.get("/skill-runs/:run_id", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 0 placeholder" })
  );

  app.post("/skill-runs/:run_id/dry-run", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 0 placeholder" })
  );

  app.post("/skill-runs/:run_id/execute", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 0 placeholder" })
  );
};
