import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateRunAnalysis, generateTraceAnalysis, getRunAnalysis } from "../services/ai-run-analysis-service";

const runParamsSchema = z.object({
  run_id: z.string()
});

const traceParamsSchema = z.object({
  trace_id: z.string()
});

export const registerAiAnalysisRoutes: FastifyPluginAsync = async (app) => {
  app.post("/skill-runs/:run_id/ai-analysis", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const result = await generateRunAnalysis({
      prisma: app.services.prisma,
      runId,
      provider: app.services.aiProvider,
      config: app.services.aiConfig
    });

    return reply.code(result.status).send(result.body);
  });

  app.get("/skill-runs/:run_id/ai-analysis", async (request, reply) => {
    const { run_id: runId } = runParamsSchema.parse(request.params);
    const result = await getRunAnalysis(app.services.prisma, runId);

    return reply.code(result.status).send(result.body);
  });

  app.post("/audit/:trace_id/ai-summary", async (request, reply) => {
    const { trace_id: traceId } = traceParamsSchema.parse(request.params);
    const result = await generateTraceAnalysis({
      prisma: app.services.prisma,
      traceId,
      provider: app.services.aiProvider,
      config: app.services.aiConfig
    });

    return reply.code(result.status).send(result.body);
  });
};
