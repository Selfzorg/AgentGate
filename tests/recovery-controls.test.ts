import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { approveRequest } from "../apps/api-server/src/services/approval-service";
import { createDecisionService } from "../apps/api-server/src/services/decision-service";
import { processEvidenceTasksOnce } from "../apps/api-server/src/services/evidence-task-service";

const prisma = new PrismaClient();
const configDir = join(process.cwd(), "configs");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recovery controls for policy, evidence, and execution", () => {
  it("imports, exports, and enforces DB-backed policy packs with warn rollout mode", async () => {
    const tenantId = `tenant_policy_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const workspaceId = `workspace_${tenantId}`;
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "Policy Pack Tenant",
        workspaces: {
          create: {
            id: workspaceId,
            key: "policy-pack",
            name: "Policy Pack Workspace"
          }
        }
      }
    });

    const app = await createApp({ prisma, logger: false });
    try {
      const importResponse = await app.inject({
        method: "POST",
        url: "/api/v1/policy-packs/import",
        payload: {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          pack_id: "repo-main-guardrails",
          name: "Repo Main Guardrails",
          scope: "repo",
          source: "policy-pack-test",
          rollout_mode: "enforce",
          rules: [
            {
              policy_id: "deny-tests-from-code-agent",
              name: "Deny test command from code agent",
              priority: 500,
              when: {
                role: "code_agent",
                skill: "run-tests"
              },
              decision: "DENY",
              reason: "Policy pack deny rule matched.",
              required_checks: [],
              approvers: []
            }
          ]
        }
      });
      expect(importResponse.statusCode).toBe(201);
      expect(importResponse.json().imported).toHaveLength(1);

      const exportResponse = await app.inject({
        method: "GET",
        url: `/api/v1/policy-packs/repo-main-guardrails/export?tenant_id=${tenantId}&workspace_id=${workspaceId}`
      });
      expect(exportResponse.statusCode).toBe(200);
      expect(exportResponse.json().export.rules[0]).toMatchObject({
        policy_id: "deny-tests-from-code-agent",
        decision: "DENY"
      });

      const basePayload = {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        source: "codex",
        adapter_type: "hook",
        agent: {
          agent_id: "agent_policy_pack",
          agent_type: "codex_cli",
          role: "code_agent"
        },
        tool: {
          tool_name: "Bash"
        },
        raw_action: "pnpm test",
        context: {
          repo: "agentgate"
        }
      };

      const enforced = await createDecisionService({ prisma, configDir }).evaluate(basePayload);
      expect(enforced).toMatchObject({
        decision: "DENY",
        reason: "Policy pack deny rule matched.",
        mode: "enforce"
      });

      const warned = await createDecisionService({ prisma, configDir }).evaluate({
        ...basePayload,
        context: {
          repo: "agentgate",
          policy_mode: "warn"
        }
      });
      expect(warned).toMatchObject({
        decision: "ALLOW",
        policy_decision: "DENY",
        mode: "warn"
      });
    } finally {
      await app.close();
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
  });

  it("reuses fresh evidence only for the same repo commit and environment", async () => {
    const fixtures = await loadDemoFixtures(configDir);
    const action = fixtures.actions.actions.find((candidate) => candidate.id === "production_deploy");
    expect(action).toBeDefined();
    const commitSha = `cafebabecache${Date.now()}`;

    const firstDecision = await createDecisionService({ prisma, configDir }).evaluate({
      ...action!.payload,
      context: {
        ...action!.payload.context,
        commit_sha: commitSha
      }
    });
    expect(firstDecision.decision).toBe("REQUIRE_APPROVAL");
    const firstRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: firstDecision.run_id },
      include: { evidenceTasks: true }
    });
    expect(firstRun.evidenceTasks.length).toBeGreaterThan(0);

    await processEvidenceTasksOnce({
      prisma,
      skillRunId: firstDecision.run_id,
      limit: 50,
      agentId: "cache_test_worker"
    });
    const cacheRows = await prisma.evidenceArtifactCache.findMany({
      where: {
        tenantId: "tenant_demo",
        workspaceId: "workspace_demo",
        commitSha
      }
    });
    expect(cacheRows.length).toBeGreaterThan(0);

    const secondDecision = await createDecisionService({ prisma, configDir }).evaluate({
      ...action!.payload,
      context: {
        ...action!.payload.context,
        commit_sha: commitSha
      }
    });
    const secondRun = await prisma.skillRun.findUniqueOrThrow({
      where: { id: secondDecision.run_id },
      include: {
        evidenceTasks: true,
        gateCheckResults: true,
        approvalRequest: true
      }
    });
    expect(secondRun.evidenceTasks).toHaveLength(0);
    expect(secondRun.gateCheckResults.every((check) => check.evidence && JSON.stringify(check.evidence).includes("evidence_cache"))).toBe(true);
    expect(secondRun.approvalRequest?.approvalReadiness).toBe("ready");
  });

  it("exposes execution leases for external runners", async () => {
    const app = await createApp({ prisma, logger: false });
    try {
      const { decision, approval } = await approvedProductionDeploy();
      const token = await issueToken(app, decision.run_id, approval.id);
      const queue = await app.inject({
        method: "POST",
        url: `/api/v1/skill-runs/${decision.run_id}/execute`,
        payload: {
          execution_token_id: token.execution_token.execution_token_id,
          idempotency_key: `lease-${decision.run_id}`
        }
      });
      expect(queue.statusCode).toBe(202);

      const claim = await app.inject({
        method: "POST",
        url: `/api/v1/skill-runs/${decision.run_id}/execution-lease/claim`,
        payload: {
          runner_id: "external_codex_runner",
          lease_seconds: 30
        }
      });
      expect(claim.statusCode).toBe(200);
      expect(claim.json().execution_lease.runner_id).toBe("external_codex_runner");

      const heartbeat = await app.inject({
        method: "POST",
        url: `/api/v1/skill-runs/${decision.run_id}/execution-lease/heartbeat`,
        payload: {
          runner_id: "external_codex_runner",
          lease_seconds: 30
        }
      });
      expect(heartbeat.statusCode).toBe(200);

      const complete = await app.inject({
        method: "POST",
        url: `/api/v1/skill-runs/${decision.run_id}/execution-lease/complete`,
        payload: {
          runner_id: "external_codex_runner",
          status: "completed",
          result: {
            external_runtime: "codex_cli"
          }
        }
      });
      expect(complete.statusCode).toBe(200);
      const run = await prisma.skillRun.findUniqueOrThrow({
        where: { id: decision.run_id },
        include: { skillRunAttempts: true }
      });
      expect(run.status).toBe("completed");
      expect(run.skillRunAttempts[0]?.leaseExpiresAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("blocks imported-skill execution when the approved version is disabled after approval", async () => {
    await withTempWorkspace(async (workspace) => {
      await createImportedDeploySkill(workspace);
      const tenantId = `tenant_exec_hash_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const workspaceId = `workspace_${tenantId}`;
      await prisma.tenant.create({
        data: {
          id: tenantId,
          name: "Execution Hash Tenant",
          workspaces: {
            create: {
              id: workspaceId,
              key: "execution-hash",
              name: "Execution Hash Workspace"
            }
          }
        }
      });

      const app = await createApp({ prisma, logger: false });
      try {
        const imported = await app.inject({
          method: "POST",
          url: "/api/v1/registry/import",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            root_dir: workspace
          }
        });
        await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${imported.json().import_batch.id}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"]
          }
        });

        const decision = await createDecisionService({ prisma, configDir }).evaluate({
          tenant_id: tenantId,
          workspace_id: workspaceId,
          source: "codex",
          adapter_type: "hook",
          agent: {
            agent_id: "agent_hash_guard",
            agent_type: "codex_cli",
            role: "release_agent"
          },
          tool: {
            tool_name: "Bash"
          },
          raw_action: "deploy checkout-api to production",
          context: {
            repo: "agentgate",
            environment: "production"
          }
        });
        expect(decision.decision).toBe("REQUIRE_APPROVAL");
        await processEvidenceTasksOnce({
          prisma,
          skillRunId: decision.run_id,
          limit: 50,
          agentId: "hash_guard_worker"
        });

        const approval = await prisma.approvalRequest.findUniqueOrThrow({
          where: { skillRunId: decision.run_id }
        });
        const approved = await approveRequest(prisma, {
          approvalId: approval.id,
          actorId: "user_service_owner",
          comment: "Imported skill approved before disable."
        });
        expect(approved.status).toBe(200);
        const token = await app.inject({
          method: "POST",
          url: "/api/v1/execution-tokens",
          payload: {
            skill_run_id: decision.run_id,
            approval_id: approval.id,
            include_token_value: true
          }
        });
        expect(token.statusCode).toBe(201);

        const skill = await prisma.skill.findFirstOrThrow({
          where: {
            tenantId,
            workspaceId,
            skillId: decision.skill_id
          },
          include: { versions: true }
        });
        await prisma.skillVersion.update({
          where: { id: skill.versions[0]!.id },
          data: { status: "inactive" }
        });

        const execute = await app.inject({
          method: "POST",
          url: `/api/v1/skill-runs/${decision.run_id}/execute`,
          payload: {
            execution_token: token.json().execution_token.token_value,
            idempotency_key: `hash-guard-${decision.run_id}`
          }
        });
        expect(execute.statusCode).toBe(409);
        expect(execute.json().error).toContain("re-approval");
      } finally {
        await app.close();
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      }
    });
  });
});

async function approvedProductionDeploy() {
  const fixtures = await loadDemoFixtures(configDir);
  const action = fixtures.actions.actions.find((candidate) => candidate.id === "production_deploy");
  expect(action).toBeDefined();
  const decision = await createDecisionService({ prisma, configDir }).evaluate(action!.payload);
  await processEvidenceTasksOnce({
    prisma,
    skillRunId: decision.run_id,
    limit: 50,
    agentId: "lease_test_worker"
  });
  const approval = await prisma.approvalRequest.findUniqueOrThrow({
    where: { skillRunId: decision.run_id }
  });
  const approved = await approveRequest(prisma, {
    approvalId: approval.id,
    actorId: "user_service_owner",
    comment: "Lease test approval."
  });
  expect(approved.status).toBe(200);
  return { decision, approval };
}

async function issueToken(app: Awaited<ReturnType<typeof createApp>>, runId: string, approvalId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/execution-tokens",
    payload: {
      skill_run_id: runId,
      approval_id: approvalId
    }
  });
  expect([200, 201]).toContain(response.statusCode);
  return response.json() as {
    execution_token: {
      execution_token_id: string;
    };
  };
}

async function withTempWorkspace(test: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), "agentgate-recovery-controls-"));
  try {
    await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function createImportedDeploySkill(workspace: string) {
  const dir = join(workspace, ".agents", "skills", "deploy-prod");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    [
      "---",
      "name: Deploy Production",
      "description: Deploy checkout-api to production.",
      "tools: Bash(vercel deploy:*)",
      "---",
      "",
      "Deploy checkout-api to production."
    ].join("\n"),
    "utf8"
  );
}
