import { join } from "node:path";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { createDecisionService } from "../apps/api-server/src/services/decision-service";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Evidence worker capability tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function replay(actionId: string) {
  const fixtures = await loadDemoFixtures(configDir);
  const action = fixtures.actions.actions.find((candidate) => candidate.id === actionId);
  expect(action).toBeDefined();
  return createDecisionService({ prisma, configDir }).evaluate(action!.payload);
}

describe("evidence worker capabilities", () => {
  it("records heartbeat capabilities and enforces them when claiming evidence tasks", async () => {
    const app = await createApp({ prisma, logger: false });
    const decision = await replay("production_deploy");
    const task = await prisma.evidenceTask.findFirstOrThrow({
      where: {
        skillRunId: decision.run_id,
        status: "queued"
      },
      orderBy: { createdAt: "asc" }
    });
    const allowedRuntimes = allowedRuntimesFromTask(task.input);
    const rejectedRuntime = allowedRuntimes.find((runtime) => runtime !== task.runtime);
    expect(rejectedRuntime).toBeDefined();

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/v1/evidence-workers/heartbeat",
      payload: {
        tenant_id: task.tenantId,
        workspace_id: task.workspaceId,
        agent_id: "capability_worker",
        runtime: task.runtime,
        driver: task.runtime.includes("codex") ? "codex" : "claude",
        status: "idle",
        capabilities: {
          runtime_ids: [task.runtime],
          allowed_tools: ["read_files", "rg", "git_show"],
          side_effect_levels: ["read_only"],
          max_parallel_tasks: 2,
          supports_json_schema: true
        }
      }
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().evidence_worker.capabilities).toMatchObject({
      runtime_ids: [task.runtime],
      allowed_tools: ["read_files", "rg", "git_show"],
      side_effect_levels: ["read_only"],
      max_parallel_tasks: 2,
      supports_json_schema: true
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/evidence-tasks/${task.id}/claim`,
      payload: {
        agent_id: "capability_worker",
        runtime: rejectedRuntime
      }
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({
      error: `Worker capabilities do not allow runtime ${rejectedRuntime}.`,
      requested_runtime: rejectedRuntime,
      worker_agent_id: "capability_worker"
    });

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/evidence-tasks/${task.id}/claim`,
      payload: {
        agent_id: "capability_worker",
        runtime: task.runtime
      }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().evidence_task.runtime).toBe(task.runtime);

    await app.close();
  });
});

function allowedRuntimesFromTask(input: unknown): string[] {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const evidenceSkill =
    record.evidence_skill && typeof record.evidence_skill === "object" && !Array.isArray(record.evidence_skill)
      ? (record.evidence_skill as Record<string, unknown>)
      : {};
  return Array.isArray(evidenceSkill.allowed_runtimes)
    ? evidenceSkill.allowed_runtimes.filter((runtime): runtime is string => typeof runtime === "string")
    : [];
}
