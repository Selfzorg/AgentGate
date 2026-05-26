import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { startRunnerLoop } from "@agentgate/runner-worker";
import { createApp } from "./app";

const prisma = new PrismaClient();
const app = await createApp({ prisma });
const runner = startRunnerLoop({ prisma });

const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number(process.env.API_PORT ?? 4000);

const shutdown = async () => {
  runner.stop();
  await app.close();
  await prisma.$disconnect();
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

try {
  await app.listen({ host, port });
  app.log.info(`AgentGate API listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exit(1);
}
