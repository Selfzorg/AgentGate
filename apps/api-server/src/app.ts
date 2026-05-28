import cors from "@fastify/cors";
import type { AiProvider, AiProviderConfig } from "@agentgate/ai-provider";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAiAnalysisRoutes } from "./routes/ai-analysis.routes";
import { registerApprovalsRoutes } from "./routes/approvals.routes";
import { registerAuditRoutes } from "./routes/audit.routes";
import { registerCatalogRoutes } from "./routes/catalog.routes";
import { registerDecisionRoutes } from "./routes/decision.routes";
import { registerDemoRoutes } from "./routes/demo.routes";
import { registerExecutionTokenRoutes } from "./routes/execution-tokens.routes";
import { registerEvidenceMonitorRoutes } from "./routes/evidence-monitor.routes";
import { registerEvidenceTasksRoutes } from "./routes/evidence-tasks.routes";
import { registerMcpRoutes } from "./routes/mcp.routes";
import { registerRiskScannerRoutes } from "./routes/risk-scanner.routes";
import { registerSkillRunsRoutes } from "./routes/skill-runs.routes";
import { registerSseRoutes } from "./routes/sse.routes";

export type AppServices = {
  prisma: PrismaClient;
  logger?: boolean;
  aiProvider?: AiProvider | undefined;
  aiConfig?: AiProviderConfig | undefined;
};

export async function createApp(services: AppServices): Promise<FastifyInstance> {
  const app = Fastify({
    logger: services.logger ?? true
  });

  app.decorate("services", services);

  await app.register(cors, {
    origin: true
  });

  app.get("/health", async () => ({
    ok: true,
    service: "agentgate-api",
    phase: "3"
  }));

  await app.register(registerDecisionRoutes, { prefix: "/api/v1" });
  await app.register(registerMcpRoutes, { prefix: "/api/v1" });
  await app.register(registerDemoRoutes, { prefix: "/api/v1" });
  await app.register(registerApprovalsRoutes, { prefix: "/api/v1" });
  await app.register(registerAiAnalysisRoutes, { prefix: "/api/v1" });
  await app.register(registerRiskScannerRoutes, { prefix: "/api/v1" });
  await app.register(registerSkillRunsRoutes, { prefix: "/api/v1" });
  await app.register(registerExecutionTokenRoutes, { prefix: "/api/v1" });
  await app.register(registerEvidenceMonitorRoutes, { prefix: "/api/v1" });
  await app.register(registerEvidenceTasksRoutes, { prefix: "/api/v1" });
  await app.register(registerAuditRoutes, { prefix: "/api/v1" });
  await app.register(registerCatalogRoutes, { prefix: "/api/v1" });
  await app.register(registerSseRoutes, { prefix: "/api/v1" });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    services: AppServices;
  }
}
