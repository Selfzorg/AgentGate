import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoFixtures } from "@agentgate/config-loader";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createDecisionService } from "../services/decision-service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const configDir = join(repoRoot, "configs");
const replayParamsSchema = z.object({
  action_id: z.string()
});

export const registerDemoRoutes: FastifyPluginAsync = async (app) => {
  app.get("/demo/actions", async () => {
    const fixtures = await loadDemoFixtures(configDir);

    return {
      actions: fixtures.actions.actions.map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        expected_decision: action.expected_decision,
        button_label: action.button_label,
        payload_preview: action.payload_preview
      }))
    };
  });

  app.post("/demo/actions/:action_id/replay", async (request, reply) => {
    const { action_id: actionId } = replayParamsSchema.parse(request.params);
    const fixtures = await loadDemoFixtures(configDir);
    const action = fixtures.actions.actions.find((candidate) => candidate.id === actionId);

    if (!action) {
      return reply.code(404).send({
        error: "Demo action not found",
        action_id: actionId
      });
    }

    const service = createDecisionService({ prisma: app.services.prisma, configDir });
    const decision = await service.evaluate(action.payload);

    return {
      action_id: actionId,
      decision
    };
  });

  app.post("/demo/scenario/replay", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const service = createDecisionService({ prisma: app.services.prisma, configDir });
    const decisions = [];

    for (const action of fixtures.actions.actions) {
      decisions.push({
        action_id: action.id,
        decision: await service.evaluate(action.payload)
      });
    }

    return {
      scenario: "phase_1_decision_replay",
      decisions
    };
  });
};
