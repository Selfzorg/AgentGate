import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { scanAgentSkills } from "@agentgate/skill-registry";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const createdTenantIds: string[] = [];

beforeEach(async () => {
  const tenantId = `tenant_import_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  createdTenantIds.push(tenantId);
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: "Import Test Tenant",
      workspaces: {
        create: {
          id: workspaceIdForTenant(tenantId),
          key: "import-test",
          name: "Import Test Workspace"
        }
      }
    }
  });
});

afterEach(async () => {
  const tenantId = createdTenantIds.pop();
  if (tenantId) {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  }
});

describe("AgentGate skill import recovery scope", () => {
  it("scans 50+ skills, Claude commands, subagents, MCP configs, duplicate names, and stable hashes", async () => {
    await withTempWorkspace(async (workspace) => {
      await createCodexSkillSet(workspace, 52);
      await createClaudeFixtures(workspace);
      await createMcpFixtures(workspace);
      await symlink(join(workspace, ".agents", "skills", "skill-001"), join(workspace, ".agents", "skills", "linked-skill"));

      const firstScan = await scanAgentSkills({ rootDir: workspace });
      expect(firstScan.summary.total).toBeGreaterThanOrEqual(62);
      expect(firstScan.summary.bySourceType.codex_skill).toBe(52);
      expect(firstScan.summary.bySourceType.claude_skill).toBe(1);
      expect(firstScan.summary.bySourceType.claude_command).toBeGreaterThanOrEqual(2);
      expect(firstScan.summary.bySourceType.claude_subagent).toBe(1);
      expect(firstScan.summary.bySourceType.mcp_tool).toBeGreaterThanOrEqual(9);
      expect(firstScan.summary.bySourceType.native_connector).toBeGreaterThanOrEqual(1);
      expect(firstScan.duplicateGroups.some((group) => group.normalizedName === "shared-release-helper")).toBe(true);
      expect(firstScan.warnings.some((warning) => warning.includes("Skipped symlink"))).toBe(true);
      expect(firstScan.candidates.some((candidate) => candidate.warnings.some((warning) => warning.includes("local tool metadata is unavailable")))).toBe(true);

      const deployCandidate = firstScan.candidates.find((candidate) => candidate.relativePath.includes("skill-001/SKILL.md"));
      expect(deployCandidate?.contentHash).toMatch(/^sha256:/);
      expect(deployCandidate?.warnings).toEqual(expect.arrayContaining(["Mutating skill requires owner and policy review before enablement."]));
      expect(deployCandidate?.warnings).toEqual(expect.arrayContaining(["Dynamic shell block detected; review generated commands and side effects."]));
      expect(deployCandidate?.metadata.supporting_files).toEqual(expect.arrayContaining(["scripts/deploy.sh"]));
      expect(deployCandidate?.metadata.dynamic_shell_block_count).toBe(1);

      await writeFile(
        join(workspace, ".agents", "skills", "skill-001", "scripts", "deploy.sh"),
        "#!/usr/bin/env bash\nvercel deploy --prod --confirm\n",
        "utf8"
      );
      const secondScan = await scanAgentSkills({ rootDir: workspace });
      const changedCandidate = secondScan.candidates.find((candidate) => candidate.relativePath.includes("skill-001/SKILL.md"));
      expect(changedCandidate?.contentHash).not.toBe(deployCandidate?.contentHash);

      const { stdout } = await execFileAsync("pnpm", ["exec", "agentgate", "skills", "scan", "--root", workspace, "--json"], {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024
      });
      const cliJson = JSON.parse(stdout);
      expect(cliJson.scan.summary.total).toBe(secondScan.summary.total);
      expect(cliJson.scan.duplicateGroups.length).toBe(secondScan.duplicateGroups.length);
    });
  });

  it("persists import batches and writes duplicate-safe skill_versions.config snapshots", async () => {
    await withTempWorkspace(async (workspace) => {
      await createCodexSkillSet(workspace, 51);
      await createClaudeFixtures(workspace);
      await createMcpFixtures(workspace);

      const tenantId = createdTenantIds.at(-1)!;
      const workspaceId = workspaceIdForTenant(tenantId);
      const app = await createApp({ prisma, logger: false });
      try {
        const importResponse = await app.inject({
          method: "POST",
          url: "/api/v1/registry/import",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            root_dir: workspace,
            requested_by: "user_import_reviewer"
          }
        });

        expect(importResponse.statusCode).toBe(201);
        const importBody = importResponse.json();
        expect(importBody.import_batch.candidate_count).toBeGreaterThanOrEqual(60);
        expect(importBody.import_batch.candidates).toHaveLength(importBody.import_batch.candidate_count);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importBody.import_batch.id}/approve`,
          payload: {
            reviewed_by: "user_import_reviewer",
            comment: "Owner reviewed imported skills.",
            owners: ["service_owner"],
            approver_roles: ["service_owner"]
          }
        });

        expect(approveResponse.statusCode).toBe(200);
        const approveBody = approveResponse.json();
        expect(approveBody.imported.length).toBeGreaterThanOrEqual(60);
        expect(approveBody.disabled).toEqual([]);

        const importedSkill = await prisma.skill.findFirstOrThrow({
          where: {
            tenantId,
            workspaceId,
            skillId: { contains: "skill-001" }
          },
          include: {
            versions: true
          }
        });
        const version = importedSkill.versions[0]!;
        const config = version.config as Record<string, unknown>;
        expect(config).toMatchObject({
          skill_type: "execution",
          side_effect_level: "mutating",
          owners: ["service_owner"],
          approver_roles: ["service_owner"],
          dynamic_shell_blocks: expect.any(Array),
          supporting_file_count: expect.any(Number),
          import_batch_id: importBody.import_batch.id
        });
        expect((config.source as Record<string, unknown>).path).toContain("skill-001/SKILL.md");
        expect((config.source as Record<string, unknown>).content_hash).toMatch(/^sha256:/);
        expect(Array.isArray(config.declared_tools)).toBe(true);
        expect(Array.isArray(config.allowed_runtimes)).toBe(true);
        expect(version.version).toMatch(/^import-[a-f0-9]{12}$/);

        const secondImportResponse = await app.inject({
          method: "POST",
          url: "/api/v1/registry/import",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            root_dir: workspace
          }
        });
        const secondImportBody = secondImportResponse.json();
        const secondApproveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${secondImportBody.import_batch.id}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"]
          }
        });
        expect(secondApproveResponse.statusCode).toBe(200);
        expect(secondApproveResponse.json().skipped.length).toBeGreaterThanOrEqual(60);

        const duplicateNameSkills = await prisma.skill.findMany({
          where: {
            tenantId,
            workspaceId,
            name: "Shared Release Helper"
          }
        });
        expect(duplicateNameSkills.length).toBe(2);
        expect(new Set(duplicateNameSkills.map((skill) => skill.skillId)).size).toBe(2);
      } finally {
        await app.close();
      }
    });
  });

  it("rejects import batches without writing skills and disables risky imports without owner review", async () => {
    await withTempWorkspace(async (workspace) => {
      await createCodexSkillSet(workspace, 2);
      const tenantId = createdTenantIds.at(-1)!;
      const workspaceId = workspaceIdForTenant(tenantId);
      const app = await createApp({ prisma, logger: false });
      try {
        const rejectImport = await app.inject({
          method: "POST",
          url: "/api/v1/registry/import",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            root_dir: workspace
          }
        });
        const rejectedBatchId = rejectImport.json().import_batch.id;
        const rejectResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${rejectedBatchId}/reject`,
          payload: {
            reviewed_by: "user_import_reviewer",
            comment: "Rejecting test import."
          }
        });
        expect(rejectResponse.statusCode).toBe(200);
        expect(await prisma.skill.count({ where: { tenantId, workspaceId } })).toBe(0);

        const disabledImport = await app.inject({
          method: "POST",
          url: "/api/v1/registry/import",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            root_dir: workspace
          }
        });
        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${disabledImport.json().import_batch.id}/approve`,
          payload: {
            reviewed_by: "user_import_reviewer"
          }
        });

        expect(approveResponse.statusCode).toBe(200);
        expect(approveResponse.json().disabled.length).toBeGreaterThan(0);
        const inactiveVersions = await prisma.skillVersion.count({
          where: {
            tenantId,
            workspaceId,
            status: "inactive"
          }
        });
        expect(inactiveVersions).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    });
  });

  it("uses active imported registry metadata in decisions and requires raw bearer execution outside legacy mode", async () => {
    await withTempWorkspace(async (workspace) => {
      await createCodexSkillSet(workspace, 1);
      const tenantId = createdTenantIds.at(-1)!;
      const workspaceId = workspaceIdForTenant(tenantId);
      const app = await createApp({ prisma, logger: false });
      const previousLegacySetting = process.env.AGENTGATE_ALLOW_LEGACY_TOKEN_ID;
      try {
        const importResponse = await app.inject({
          method: "POST",
          url: "/api/v1/registry/import",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            root_dir: workspace
          }
        });
        const batchId = importResponse.json().import_batch.id as string;
        await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${batchId}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"]
          }
        });

        const payload = {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          source: "codex",
          adapter_type: "hook",
          agent: {
            agent_id: "codex_import_test",
            agent_type: "codex_cli",
            role: "release_agent"
          },
          tool: {
            tool_name: "Bash"
          },
          raw_action: "Please deploy checkout-api to production using vercel deploy --prod.",
          context: {
            environment: "production",
            service: "checkout-api"
          }
        };

        const simulation = await app.inject({
          method: "POST",
          url: "/api/v1/risk-scanner/simulate",
          payload: { payload }
        });
        expect(simulation.statusCode).toBe(200);
        expect(simulation.json().registry_resolution.imported_selected.skill_id).toContain("skill-001");

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload
        });
        expect(decision.statusCode).toBe(200);
        const decisionBody = decision.json();
        expect(decisionBody.skill_id).toContain("skill-001");
        expect(decisionBody.skill_version).toMatch(/^import-[a-f0-9]{12}$/);
        expect(decisionBody.risk_level).toBe("high");
        expect(decisionBody.decision).toBe("REQUIRE_APPROVAL");

        const approval = await prisma.approvalRequest.findUniqueOrThrow({
          where: { skillRunId: decisionBody.run_id }
        });
        await app.inject({
          method: "POST",
          url: `/api/v1/approvals/${approval.id}/approve`,
          payload: {
            comment: "Imported deploy skill reviewed."
          }
        });

        const token = await app.inject({
          method: "POST",
          url: "/api/v1/execution-tokens",
          payload: {
            skill_run_id: decisionBody.run_id,
            approval_id: approval.id,
            include_token_value: true
          }
        });
        const tokenBody = token.json();
        expect(tokenBody.execution_token.token_value).toEqual(expect.any(String));

        process.env.AGENTGATE_ALLOW_LEGACY_TOKEN_ID = "false";
        const visibleTokenOnly = await app.inject({
          method: "POST",
          url: `/api/v1/skill-runs/${decisionBody.run_id}/execute`,
          payload: {
            execution_token_id: tokenBody.execution_token.execution_token_id,
            idempotency_key: `visible-token-${decisionBody.run_id}`
          }
        });
        expect(visibleTokenOnly.statusCode).toBe(403);
        expect(visibleTokenOnly.json().error).toContain("Raw bearer execution token");

        const rawBearer = await app.inject({
          method: "POST",
          url: `/api/v1/skill-runs/${decisionBody.run_id}/execute`,
          payload: {
            execution_token: tokenBody.execution_token.token_value,
            idempotency_key: `raw-token-${decisionBody.run_id}`
          }
        });
        expect(rawBearer.statusCode).toBe(202);
      } finally {
        if (previousLegacySetting === undefined) {
          delete process.env.AGENTGATE_ALLOW_LEGACY_TOKEN_ID;
        } else {
          process.env.AGENTGATE_ALLOW_LEGACY_TOKEN_ID = previousLegacySetting;
        }
        await app.close();
      }
    });
  });
});

async function withTempWorkspace(test: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), "agentgate-imports-"));
  try {
    await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function createCodexSkillSet(workspace: string, count: number) {
  for (let index = 1; index <= count; index += 1) {
    const id = `skill-${String(index).padStart(3, "0")}`;
    const dir = join(workspace, ".agents", "skills", id);
    await mkdir(dir, { recursive: true });
    if (index === 1) await mkdir(join(dir, "scripts"), { recursive: true });
    const duplicateName = index === 50 || index === 51 ? "Shared Release Helper" : `Imported Skill ${index}`;
    const mutatingText = index === 1 ? "Deploy checkout-api to production using vercel deploy --prod." : "Inspect project state and summarize findings.";
    const tools = index === 1 ? "tools: Bash(vercel deploy:*)" : "tools: Read, Grep";
    await writeFile(
      join(dir, "SKILL.md"),
      [
        "---",
        `name: ${duplicateName}`,
        `description: ${mutatingText}`,
        tools,
        "---",
        "",
        mutatingText,
        ...(index === 1
          ? [
              "",
              "```bash",
              "vercel deploy --prod --confirm",
              "```"
            ]
          : [])
      ].join("\n"),
      "utf8"
    );
    if (index === 1) {
      await writeFile(join(dir, "scripts", "deploy.sh"), "#!/usr/bin/env bash\nvercel deploy --prod\n", "utf8");
    }
  }
}

async function createClaudeFixtures(workspace: string) {
  await mkdir(join(workspace, ".claude", "commands", "checks"), { recursive: true });
  await mkdir(join(workspace, ".claude", "agents"), { recursive: true });
  await mkdir(join(workspace, ".claude", "skills", "release-auditor"), { recursive: true });
  await writeFile(
    join(workspace, ".claude", "commands", "checks", "verify-ci.md"),
    ["---", "description: Verify CI status", "allowed-tools: Read, Grep, Bash(git status:*)", "---", "", "Read CI status only."].join("\n"),
    "utf8"
  );
  await writeFile(
    join(workspace, ".claude", "commands", "deploy-prod.md"),
    ["---", "description: Deploy production service", "allowed-tools: Bash(vercel deploy:*)", "---", "", "Deploy production."].join("\n"),
    "utf8"
  );
  await writeFile(
    join(workspace, ".claude", "agents", "release-reviewer.md"),
    ["---", "description: Review release readiness", "tools: Read, Grep", "---", "", "Check release readiness."].join("\n"),
    "utf8"
  );
  await writeFile(
    join(workspace, ".claude", "skills", "release-auditor", "SKILL.md"),
    ["---", "name: Release Auditor", "description: Verify production release evidence.", "tools: Read, Grep", "---", "", "Read-only evidence check."].join("\n"),
    "utf8"
  );
}

async function createMcpFixtures(workspace: string) {
  await mkdir(join(workspace, ".codex"), { recursive: true });
  await writeFile(
    join(workspace, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        agentgate: {
          type: "stdio",
          command: "pnpm",
          args: ["mcp:start"]
        },
        github: {
          type: "stdio",
          command: "github-mcp"
        }
      }
    }),
    "utf8"
  );
  await writeFile(
    join(workspace, ".codex", "config.toml"),
    ['[mcp_servers.agentgate]', 'command = "pnpm"', 'args = ["mcp:start"]', "", "[mcp_servers.internal]"].join("\n"),
    "utf8"
  );
  await mkdir(join(workspace, ".agentgate", "connectors"), { recursive: true });
  await writeFile(
    join(workspace, ".agentgate", "connectors", "github-merge.json"),
    JSON.stringify({
      connector_id: "github-merge",
      name: "GitHub Merge Connector",
      description: "Merge pull requests through a native connector.",
      operations: ["merge_pr"],
      scopes: ["git:merge"]
    }),
    "utf8"
  );
}

function workspaceIdForTenant(tenantId: string) {
  return `workspace_${tenantId}`;
}
