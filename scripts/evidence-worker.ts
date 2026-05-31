import { PrismaClient } from "@prisma/client";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";
import {
  markEvidenceWorkerStopped,
  recordEvidenceWorkerHeartbeat
} from "../apps/api-server/src/services/evidence-worker-service";

const prisma = new PrismaClient();
const intervalMs = Number(process.env.AGENTGATE_EVIDENCE_WORKER_INTERVAL_MS ?? 1000);
const once = process.argv.includes("--once");
const agentId = process.env.AGENTGATE_EVIDENCE_WORKER_AGENT_ID ?? "local_deterministic_worker";
let stopped = false;

async function tick() {
  await heartbeat("idle");
  const result = await processEvidenceTasksOnce({
    prisma,
    limit: Number(process.env.AGENTGATE_EVIDENCE_WORKER_LIMIT ?? 10),
    concurrency: Number(process.env.AGENTGATE_EVIDENCE_WORKER_CONCURRENCY ?? 4),
    agentId,
    skillRunId: process.env.AGENTGATE_EVIDENCE_WORKER_SKILL_RUN_ID
  });
  await heartbeat(result.claimed > 0 ? "busy" : "idle", {
    processedDelta: result.completed,
    failedDelta: Math.max(result.claimed - result.completed, 0)
  });
  if (result.claimed > 0 || process.env.AGENTGATE_EVIDENCE_WORKER_DEBUG === "true") {
    console.log(JSON.stringify({ service: "agentgate-evidence-worker", ...result }));
  }
}

async function heartbeat(
  status: "idle" | "busy" | "offline",
  counts: { processedDelta?: number; failedDelta?: number } = {}
) {
  await recordEvidenceWorkerHeartbeat(prisma, {
    tenantId: process.env.AGENTGATE_TENANT_ID ?? "tenant_demo",
    workspaceId: process.env.AGENTGATE_WORKSPACE_ID ?? "workspace_demo",
    agentId,
    runtime: "local_deterministic",
    driver: "demo-local-worker",
    status,
    processedDelta: counts.processedDelta,
    failedDelta: counts.failedDelta,
    capabilities: {
      runtimes: ["local_deterministic"],
      side_effect_levels: ["read_only", "simulated"],
      max_concurrency: Number(process.env.AGENTGATE_EVIDENCE_WORKER_CONCURRENCY ?? 4)
    },
    metadata: {
      source: "pnpm evidence:worker",
      interval_ms: intervalMs
    }
  });
}

process.once("SIGINT", () => {
  stopped = true;
});
process.once("SIGTERM", () => {
  stopped = true;
});

try {
  if (once) {
    await tick();
  } else {
    console.log(`AgentGate evidence worker polling every ${intervalMs}ms.`);
    while (!stopped) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
} finally {
  await markEvidenceWorkerStopped(prisma, {
    tenantId: process.env.AGENTGATE_TENANT_ID ?? "tenant_demo",
    workspaceId: process.env.AGENTGATE_WORKSPACE_ID ?? "workspace_demo",
    agentId
  }).catch(() => undefined);
  await prisma.$disconnect();
}
