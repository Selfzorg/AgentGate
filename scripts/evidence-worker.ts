import { PrismaClient } from "@prisma/client";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";

const prisma = new PrismaClient();
const intervalMs = Number(process.env.AGENTGATE_EVIDENCE_WORKER_INTERVAL_MS ?? 1000);
const once = process.argv.includes("--once");
let stopped = false;

async function tick() {
  const result = await processEvidenceTasksOnce({
    prisma,
    limit: Number(process.env.AGENTGATE_EVIDENCE_WORKER_LIMIT ?? 10),
    concurrency: Number(process.env.AGENTGATE_EVIDENCE_WORKER_CONCURRENCY ?? 4),
    agentId: process.env.AGENTGATE_EVIDENCE_WORKER_AGENT_ID ?? "local_deterministic_worker",
    skillRunId: process.env.AGENTGATE_EVIDENCE_WORKER_SKILL_RUN_ID
  });
  if (result.claimed > 0 || process.env.AGENTGATE_EVIDENCE_WORKER_DEBUG === "true") {
    console.log(JSON.stringify({ service: "agentgate-evidence-worker", ...result }));
  }
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
  await prisma.$disconnect();
}
