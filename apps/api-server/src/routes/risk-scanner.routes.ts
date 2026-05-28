import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoFixtures } from "@agentgate/config-loader";
import type { FastifyPluginAsync } from "fastify";
import { ZodError, z } from "zod";
import { simulatePolicyRisk } from "../services/policy-simulation-service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const configDir = join(repoRoot, "configs");

const simulationBodySchema = z.object({
  payload: z.unknown(),
  registry_root_dir: z.string().optional()
});

export const registerRiskScannerRoutes: FastifyPluginAsync = async (app) => {
  app.get("/risk-scanner/samples", async () => {
    const fixtures = await loadDemoFixtures(configDir);

    return {
      samples: fixtures.actions.actions.map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        expected_decision: action.expected_decision,
        payload: action.payload,
        payload_preview: action.payload_preview
      }))
    };
  });

  app.post("/risk-scanner/simulate", async (request, reply) => {
    try {
      const body = simulationBodySchema.parse(request.body);
      return await simulatePolicyRisk({
        rawRequest: body.payload,
        configDir,
        registryRootDir: body.registry_root_dir
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Validation error",
          issues: error.issues
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "Risk simulation failed"
      });
    }
  });
};
