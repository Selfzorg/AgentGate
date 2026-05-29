import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api-server/src/app";
import { hashExecutionToken } from "../apps/api-server/src/services/execution-token-service";
import { executeSkillRun } from "../apps/runner-worker/src/orchestrator/execute-skill-run";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: "tenant_demo" } });
  if (!tenant) {
    throw new Error("Claude handoff tests require seeded demo data. Run pnpm db:seed first.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Claude approved-run handoff", () => {
  it("creates a one-time Claude handoff command and lets Claude continue the approved run", async () => {
    await withTempWorkspace(async (workspace) => {
      await createClaudeCommand(workspace, "deploy-prod-handoff");
      const app = await createApp({ prisma, logger: false });

      try {
        const importResponse = await app.inject({
          method: "POST",
          url: "/api/v1/registry/import",
          payload: {
            tenant_id: "tenant_demo",
            workspace_id: "workspace_demo",
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);

        const batchId = importResponse.json().import_batch.id as string;
        const approveImport = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${batchId}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["release_manager"]
          }
        });
        expect(approveImport.statusCode).toBe(200);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: "tenant_demo",
            workspace_id: "workspace_demo",
            source: "claude-code",
            adapter_type: "hook",
            agent: {
              agent_id: "claude_handoff_test",
              agent_type: "claude_code",
              role: "release_agent"
            },
            tool: {
              tool_name: "/deploy-prod-handoff"
            },
            raw_action: "/deploy-prod-handoff checkout-api production",
            context: {
              repo: "agentgate",
              service: "checkout-api",
              environment: "production",
              ci_status: "passed",
              tests_status: "passed",
              rollback_plan: "exists",
              staging_deploy: "success"
            }
          }
        });
        expect(decision.statusCode).toBe(200);
        const decisionBody = decision.json();
        expect(decisionBody.decision).toBe("REQUIRE_APPROVAL");
        expect(decisionBody.skill_id).toContain("deploy-prod-handoff");

        const approval = await prisma.approvalRequest.findUniqueOrThrow({
          where: { skillRunId: decisionBody.run_id }
        });
        const approveRun = await app.inject({
          method: "POST",
          url: `/api/v1/approvals/${approval.id}/approve`,
          payload: {
            comment: "Claude handoff reviewed."
          }
        });
        expect(approveRun.statusCode).toBe(200);

        const handoff = await app.inject({
          method: "POST",
          url: `/api/v1/skill-runs/${decisionBody.run_id}/claude-handoff`,
          payload: {
            api_base_url: "http://localhost:4000",
            ttl_seconds: 300
          }
        });
        expect(handoff.statusCode).toBe(201);
        const handoffBody = handoff.json();
        const rawToken = handoffBody.claude_handoff.execution_token.token_value as string;
        expect(rawToken).toBeTruthy();
        expect(handoffBody.claude_handoff.command).toContain("agentgate claude continue");
        expect(handoffBody.claude_handoff.command).toContain(decisionBody.run_id);
        expect(handoffBody.claude_handoff.skill.source_type).toBe("claude_command");

        const storedToken = await prisma.executionToken.findFirstOrThrow({
          where: {
            skillRunId: decisionBody.run_id,
            status: "issued"
          }
        });
        expect(storedToken.tokenHash).toBe(hashExecutionToken(rawToken));

        const continued = await app.inject({
          method: "POST",
          url: `/api/v1/skill-runs/${decisionBody.run_id}/claude-handoff/continue`,
          payload: {
            execution_token: rawToken,
            idempotency_key: "claude-handoff-test"
          }
        });
        expect(continued.statusCode).toBe(202);
        expect(continued.json().claude_handoff.status).toBe("execution_queued");

        const queuedRun = await prisma.skillRun.findUniqueOrThrow({
          where: { id: decisionBody.run_id }
        });
        expect(queuedRun.status).toBe("execution_queued");
        await expect(
          prisma.executionToken.findUniqueOrThrow({
            where: { id: storedToken.id }
          })
        ).resolves.toMatchObject({ status: "used" });

        const execution = await executeSkillRun(prisma, decisionBody.run_id);
        expect(execution.status).toBe("completed");
        expect(execution.result?.connector).toBe("claude-cli-adapter");
        expect(execution.result?.summary).toContain("governed handoff simulated");
      } finally {
        await app.close();
      }
    });
  });

  it("rejects Claude handoff for non-Claude registry runs", async () => {
    const app = await createApp({ prisma, logger: false });
    try {
      const decision = await app.inject({
        method: "POST",
        url: "/api/v1/decision",
        payload: {
          tenant_id: "tenant_demo",
          workspace_id: "workspace_demo",
          source: "codex",
          adapter_type: "hook",
          agent: {
            agent_id: "codex_handoff_negative",
            agent_type: "codex_cli",
            role: "code_agent"
          },
          tool: {
            tool_name: "shell"
          },
          raw_action: "pnpm test",
          context: {
            environment: "dev"
          }
        }
      });
      expect(decision.statusCode).toBe(200);

      const handoff = await app.inject({
        method: "POST",
        url: `/api/v1/skill-runs/${decision.json().run_id}/claude-handoff`,
        payload: {}
      });
      expect(handoff.statusCode).toBe(400);
      expect(handoff.json().error).toContain("imported Claude");
    } finally {
      await app.close();
    }
  });
});

async function withTempWorkspace(test: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), "agentgate-claude-handoff-"));
  try {
    await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function createClaudeCommand(workspace: string, name: string) {
  const commandDir = join(workspace, ".claude", "commands", "release");
  await mkdir(commandDir, { recursive: true });
  await writeFile(
    join(commandDir, `${name}.md`),
    [
      "---",
      `name: ${name}`,
      "description: Deploy checkout-api to production with Claude Code after AgentGate approval.",
      "allowed-tools: Bash(vercel deploy:*)",
      "owners: release-team",
      "approver_roles: release-manager",
      "---",
      "",
      "Deploy checkout-api to production only after AgentGate approves the run.",
      "",
      "```bash",
      "vercel deploy --prod --confirm",
      "```"
    ].join("\n"),
    "utf8"
  );
}
