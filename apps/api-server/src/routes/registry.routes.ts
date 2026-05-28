import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanAgentSkills } from "@agentgate/skill-registry";
import type { FastifyPluginAsync } from "fastify";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const registerRegistryRoutes: FastifyPluginAsync = async (app) => {
  app.post("/registry/scan", async () => ({
    scan: await scanAgentSkills({
      rootDir: repoRoot
    })
  }));
};
