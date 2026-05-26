import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoFixtures } from "@agentgate/config-loader";
import type { FastifyPluginAsync } from "fastify";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const registerDemoRoutes: FastifyPluginAsync = async (app) => {
  app.get("/demo/actions", async () => {
    const fixtures = await loadDemoFixtures(join(repoRoot, "configs"));

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

  app.post("/demo/actions/:action_id/replay", async (_request, reply) =>
    reply.code(501).send({
      error: "Phase 0 placeholder",
      message: "Demo replay starts in Phase 1."
    })
  );

  app.post("/demo/scenario/replay", async (_request, reply) =>
    reply.code(501).send({
      error: "Phase 0 placeholder",
      message: "Scenario replay starts in later phases."
    })
  );
};
