import type { FastifyPluginAsync } from "fastify";
import { ZodError } from "zod";
import { createDecisionService } from "../services/decision-service";

export const registerDecisionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/decision", async (request, reply) => {
    const service = createDecisionService({ prisma: app.services.prisma });

    try {
      return await service.evaluate(request.body);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Validation error",
          issues: error.issues
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "Decision evaluation failed"
      });
    }
  });
};
