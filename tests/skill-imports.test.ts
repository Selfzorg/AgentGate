import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { scanAgentSkills } from "@agentgate/skill-registry";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";
import { callAgentGateTool } from "../apps/mcp-proxy/src/index";

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
      await symlink(
        join(workspace, ".agents", "skills", "skill-001"),
        join(workspace, ".agents", "skills", "linked-skill"),
        process.platform === "win32" ? "junction" : "dir"
      );

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
      expect((deployCandidate?.metadata.execution_snapshot as Record<string, unknown>).body).toContain("vercel deploy --prod");
      expect((deployCandidate?.metadata.execution_snapshot as Record<string, unknown>).entrypoint_content_hash).toMatch(/^sha256:/);
      expect((deployCandidate?.metadata.execution_snapshot as Record<string, unknown>).supporting_files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "scripts/deploy.sh",
            content: expect.stringContaining("vercel deploy --prod")
          })
        ])
      );

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
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === "win32"
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
          policy_aliases: ["deploy-production"],
          dynamic_shell_blocks: expect.any(Array),
          execution_snapshot: expect.objectContaining({
            version: "agentgate.skill_execution_snapshot.v1",
            body: expect.stringContaining("vercel deploy --prod"),
            supporting_files: expect.arrayContaining([
              expect.objectContaining({
                path: "scripts/deploy.sh",
                content: expect.stringContaining("vercel deploy --prod")
              })
            ])
          }),
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

  it("stores reviewed evidence checks and policy aliases from import review", async () => {
    await withTempWorkspace(async (workspace) => {
      await createEcommerceProdDeploymentCommand(workspace);
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);
        const candidate = importResponse.json().import_batch.candidates.find((entry: { name: string }) => entry.name === "prod-deployment");
        expect(candidate.inferred_policy_aliases).toEqual(["deploy-production"]);
        expect(candidate.inferred_required_checks).toEqual(["tests_passed", "security_scan_passed"]);
        expect(candidate.required_evidence_raw).toEqual(["automated-testing-report", "security-scan"]);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"],
            candidate_reviews: [
              {
                candidate_id: candidate.candidate_id,
                required_checks: ["security-scan", "custom-review"],
                policy_aliases: ["deploy-production"]
              }
            ]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const importedSkill = await prisma.skill.findFirstOrThrow({
          where: {
            tenantId,
            workspaceId,
            skillId: "claude_command:repo:claude-commands-ecommerce-prod-deployment"
          },
          include: { versions: true }
        });
        const config = importedSkill.versions[0]!.config as Record<string, unknown>;
        expect(config.required_checks).toEqual(["security_scan_passed", "custom_review"]);
        expect(config.policy_aliases).toEqual(["deploy-production"]);
        expect(config.required_evidence).toEqual(["automated-testing-report", "security-scan"]);
        expect(config.evidence_review).toMatchObject({
          reviewed_required_checks: ["security_scan_passed", "custom_review"],
          inferred_required_checks: ["tests_passed", "security_scan_passed"],
          required_evidence_raw: ["automated-testing-report", "security-scan"],
          warnings: expect.arrayContaining(["Evidence check custom_review requires a custom evidence worker or will remain missing."])
        });
      } finally {
        await app.close();
      }
    });
  });

  it("keeps imported MCP drop-table tools bound to the canonical deny policy", async () => {
    await withTempWorkspace(async (workspace) => {
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);
        const candidates = importResponse.json().import_batch.candidates as Array<{
          candidate_id: string;
          name: string;
          inferred_policy_aliases: string[];
        }>;
        const dropTableCandidates = candidates.filter((entry) => entry.name === "mcp.agentgate.agentgate_drop_table");
        expect(dropTableCandidates.length).toBeGreaterThan(0);
        expect(dropTableCandidates.every((entry) => entry.inferred_policy_aliases.length === 1 && entry.inferred_policy_aliases[0] === "drop-table")).toBe(true);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["db_owner"],
            approver_roles: ["db_owner"],
            candidate_reviews: dropTableCandidates.map((candidate) => ({
              candidate_id: candidate.candidate_id,
              policy_aliases: ["run-db-migration"]
            }))
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "mcp_proxy",
            adapter_type: "mcp_proxy",
            agent: {
              agent_id: "agent_db_001",
              agent_type: "mcp_client",
              role: "db_agent"
            },
            tool: {
              tool_name: "mcp.postgres.drop_table"
            },
            raw_action: 'mcp.postgres.drop_table({"table":"users","database":"prod-main","environment":"production"})',
            context: {
              repo: "agentgate",
              database: "prod-main",
              environment: "production"
            }
          }
        });

        expect(decision.statusCode).toBe(200);
        const body = decision.json();
        expect(body.decision).toBe("DENY");
        expect(body.skill_id).toContain("agentgate-drop-table");
        const run = await prisma.skillRun.findUniqueOrThrow({
          where: { id: body.run_id }
        });
        expect(run.matchedPolicyRecordId).toBeNull();
        expect(run.policySnapshot).toMatchObject({
          matched_policy_id: "mcp_drop_table_denied",
          policy_decision: "DENY"
        });
        expect(run.resolvedSkillSnapshot).toMatchObject({
          policy_aliases: ["drop-table", "run-db-migration"]
        });
      } finally {
        await app.close();
      }
    });
  });

  it("creates versioned UI policies and attaches them to imported skills through policy aliases", async () => {
    await withTempWorkspace(async (workspace) => {
      await createRefundMoneyCommand(workspace);
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["support-team"],
            approver_roles: ["finance-owner"]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const importedSkill = await prisma.skill.findFirstOrThrow({
          where: {
            tenantId,
            workspaceId,
            skillId: "claude_command:repo:claude-commands-ecommerce-refund-money"
          },
          include: {
            versions: {
              orderBy: { createdAt: "desc" }
            }
          }
        });
        const originalVersion = importedSkill.versions.find((version) => version.status === "active")!;

        const policyResponse = await app.inject({
          method: "POST",
          url: "/api/v1/policies",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            policy_id: "refund_prod_denied",
            name: "Refund production denied",
            priority: 200,
            when: {
              skill: "refund-money",
              environment: "production"
            },
            decision: "DENY",
            reason: "Production refunds must be blocked for this test."
          }
        });
        expect(policyResponse.statusCode).toBe(201);
        expect(policyResponse.json().policy.when).toEqual({
          skill: "refund-money",
          environment: "production"
        });

        const bindingResponse = await app.inject({
          method: "POST",
          url: `/api/v1/skills/${encodeURIComponent(importedSkill.id)}/policy-bindings`,
          payload: {
            policy_aliases: ["refund-money"]
          }
        });
        expect(bindingResponse.statusCode).toBe(201);
        expect(bindingResponse.json().warnings).toEqual([]);
        expect(bindingResponse.json().skill_version.policy_aliases).toEqual(["refund-money"]);
        expect(bindingResponse.json().skill_version.matched_policies).toEqual([
          expect.objectContaining({
            policy_id: "refund_prod_denied",
            decision: "DENY"
          })
        ]);

        const versionsAfterBinding = await prisma.skillVersion.findMany({
          where: {
            skillRecordId: importedSkill.id
          },
          orderBy: { createdAt: "asc" }
        });
        expect(versionsAfterBinding.find((version) => version.id === originalVersion.id)?.status).toBe("inactive");
        const activePolicyBindingVersion = versionsAfterBinding.find((version) => version.status === "active")!;
        expect((activePolicyBindingVersion.config as Record<string, unknown>).policy_aliases).toEqual(["refund-money"]);
        expect((activePolicyBindingVersion.config as Record<string, unknown>).policy_review).toMatchObject({
          policy_aliases: ["refund-money"],
          matched_policy_ids: ["refund_prod_denied"]
        });

        const noopBindingResponse = await app.inject({
          method: "POST",
          url: `/api/v1/skills/${encodeURIComponent(importedSkill.id)}/policy-bindings`,
          payload: {
            policy_aliases: ["refund-money"]
          }
        });
        expect(noopBindingResponse.statusCode).toBe(200);
        expect(noopBindingResponse.json().noop).toBe(true);
        expect(await prisma.skillVersion.count({ where: { skillRecordId: importedSkill.id } })).toBe(versionsAfterBinding.length);

        const listedSkills = await app.inject({
          method: "GET",
          url: "/api/v1/skills?include_inactive=true"
        });
        expect(listedSkills.statusCode).toBe(200);
        const listedSkill = listedSkills.json().skills.find((skill: { id: string }) => skill.id === importedSkill.id);
        expect(listedSkill.policy_aliases).toEqual(["refund-money"]);
        expect(listedSkill.matched_policies).toEqual([
          expect.objectContaining({
            policy_id: "refund_prod_denied",
            decision: "DENY"
          })
        ]);

        const deniedDecision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "claude-code",
            adapter_type: "hook",
            agent: {
              agent_id: "claude_refund_policy_test",
              agent_type: "claude_code",
              role: "release_agent"
            },
            tool: {
              tool_name: "Bash"
            },
            raw_action: "refund money using refund-money",
            context: {
              environment: "production",
              requested_skill: "refund-money"
            }
          }
        });
        expect(deniedDecision.statusCode).toBe(200);
        expect(deniedDecision.json()).toMatchObject({
          decision: "DENY",
          skill_id: "claude_command:repo:claude-commands-ecommerce-refund-money"
        });
        const deniedRun = await prisma.skillRun.findUniqueOrThrow({
          where: { id: deniedDecision.json().run_id }
        });
        expect(deniedRun.matchedPolicyRecordId).toBe(policyResponse.json().policy.id);
        expect(deniedRun.policySnapshot).toMatchObject({
          matched_policy_id: "refund_prod_denied",
          policy_decision: "DENY"
        });

        const editedPolicyResponse = await app.inject({
          method: "POST",
          url: "/api/v1/policies",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            policy_id: "refund_prod_denied",
            name: "Refund production requires approval",
            priority: 200,
            when: {
              skill: "refund-money",
              environment: "production"
            },
            decision: "REQUIRE_APPROVAL",
            reason: "Production refunds require finance approval.",
            required_checks: ["customer_file_not_empty"],
            approvers: ["finance-owner"]
          }
        });
        expect(editedPolicyResponse.statusCode).toBe(201);
        expect(editedPolicyResponse.json().policy.decision).toBe("REQUIRE_APPROVAL");
        const policyVersions = await prisma.policyVersion.findMany({
          where: {
            policyRecordId: policyResponse.json().policy.id
          }
        });
        expect(policyVersions).toHaveLength(2);
        expect(policyVersions.filter((version) => version.status === "active")).toHaveLength(1);

        const disabledPolicyResponse = await app.inject({
          method: "POST",
          url: `/api/v1/policies/refund_prod_denied/disable?tenant_id=${tenantId}&workspace_id=${workspaceId}`
        });
        expect(disabledPolicyResponse.statusCode).toBe(200);
        expect(disabledPolicyResponse.json().policy.status).toBe("inactive");

        const activePolicies = await app.inject({
          method: "GET",
          url: `/api/v1/policies?tenant_id=${tenantId}&workspace_id=${workspaceId}`
        });
        expect(activePolicies.statusCode).toBe(200);
        expect(activePolicies.json().policies.map((policy: { policy_id: string }) => policy.policy_id)).not.toContain("refund_prod_denied");

        const auditEvents = await prisma.auditEvent.findMany({
          where: {
            tenantId,
            workspaceId,
            eventType: {
              in: ["skill.policy_bindings.updated", "policy.updated", "policy.disabled"]
            }
          }
        });
        expect(auditEvents.map((event) => event.eventType)).toEqual(
          expect.arrayContaining(["skill.policy_bindings.updated", "policy.updated", "policy.disabled"])
        );
      } finally {
        await app.close();
      }
    });
  });

  it("reports active policy conflicts for UI-created rules with the same condition", async () => {
    const tenantId = createdTenantIds.at(-1)!;
    const workspaceId = workspaceIdForTenant(tenantId);
    const app = await createApp({ prisma, logger: false });
    try {
      for (const rule of [
        {
          policy_id: "refund_conflict_deny",
          name: "Refund conflict deny",
          decision: "DENY"
        },
        {
          policy_id: "refund_conflict_approval",
          name: "Refund conflict approval",
          decision: "REQUIRE_APPROVAL"
        }
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/policies",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            policy_id: rule.policy_id,
            name: rule.name,
            priority: 100,
            when: {
              skill: "refund-money",
              environment: "production"
            },
            decision: rule.decision,
            reason: `${rule.name} test rule.`
          }
        });
        expect(response.statusCode).toBe(201);
      }

      const conflictsResponse = await app.inject({
        method: "GET",
        url: `/api/v1/policies/conflicts?tenant_id=${tenantId}&workspace_id=${workspaceId}`
      });
      expect(conflictsResponse.statusCode).toBe(200);
      expect(conflictsResponse.json().conflicts).toEqual([
        expect.objectContaining({
          severity: "conflict",
          policies: expect.arrayContaining([
            expect.objectContaining({ policy_id: "refund_conflict_deny" }),
            expect.objectContaining({ policy_id: "refund_conflict_approval" })
          ])
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it("imports structured evidence tasks and uses them when queueing evidence", async () => {
    await withTempWorkspace(async (workspace) => {
      await createRefundMoneyCommand(workspace);
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);
        const candidate = importResponse.json().import_batch.candidates.find((entry: { name: string }) => entry.name === "refund-money");
        expect(candidate.evidence_tasks).toEqual([
          expect.objectContaining({
            check_key: "customer_file_not_empty",
            label: "Customer file is present",
            instructions: "Read customer.md and confirm it exists and is not empty.",
            allowed_actions: ["read_file"],
            target_files: ["customer.md"]
          })
        ]);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"],
            candidate_reviews: [
              {
                candidate_id: candidate.candidate_id,
                policy_aliases: ["deploy-production"],
                evidence_tasks: [
                  {
                    check_key: "customer_file_not_empty",
                    label: "Customer file is present",
                    instructions: "Read customer.md and confirm it exists and is not empty.",
                    success_criteria: ["customer.md exists", "customer.md has non-whitespace content"],
                    allowed_actions: ["read_file"],
                    target_files: ["customer.md"]
                  }
                ]
              }
            ]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const importedSkill = await prisma.skill.findFirstOrThrow({
          where: {
            tenantId,
            workspaceId,
            skillId: "claude_command:repo:claude-commands-ecommerce-refund-money"
          },
          include: { versions: true }
        });
        const config = importedSkill.versions[0]!.config as Record<string, unknown>;
        expect(config.required_checks).toEqual(["customer_file_not_empty"]);
        expect(config.evidence_tasks).toEqual([
          expect.objectContaining({
            check_key: "customer_file_not_empty",
            instructions: "Read customer.md and confirm it exists and is not empty."
          })
        ]);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "claude-code",
            adapter_type: "hook",
            agent: {
              agent_id: "claude_refund_test",
              agent_type: "claude_code",
              role: "release_agent"
            },
            tool: {
              tool_name: "Bash"
            },
            raw_action: "refund money using refund-money",
            context: {
              environment: "production",
              requested_skill: "refund-money"
            }
          }
        });
        if (decision.statusCode !== 200) {
          throw new Error(decision.body);
        }
        const decisionBody = decision.json();
        expect(decisionBody.decision).toBe("REQUIRE_APPROVAL");

        const evidenceTask = await prisma.evidenceTask.findFirstOrThrow({
          where: {
            skillRunId: decisionBody.run_id,
            checkKey: "customer_file_not_empty"
          }
        });
        const taskInput = evidenceTask.input as Record<string, unknown>;
        expect(taskInput.evidence_task).toMatchObject({
          check_key: "customer_file_not_empty",
          instructions: "Read customer.md and confirm it exists and is not empty.",
          target_files: ["customer.md"]
        });
        expect(taskInput.instruction).toBe("Read customer.md and confirm it exists and is not empty.");
      } finally {
        await app.close();
      }
    });
  });

  it("prefers an exact requested_skill over a shorter same-confidence registry match", async () => {
    await withTempWorkspace(async (workspace) => {
      await createRefundMoneyCommand(workspace);
      await createSourceCommandRefundMoneySkill(workspace);
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "mcp_proxy",
            adapter_type: "mcp_proxy",
            agent: {
              agent_id: "mcp_refund_source_command_test",
              agent_type: "mcp_proxy",
              role: "release_agent"
            },
            tool: {
              tool_name: "agentgate_govern_action"
            },
            raw_action: "trigger ecommerce-refund-money",
            context: {
              environment: "production",
              requested_skill: "source-command-ecommerce-refund-money",
              requested_skill_name: "ecommerce-refund-money"
            }
          }
        });
        expect(decision.statusCode).toBe(200);
        expect(decision.json()).toMatchObject({
          decision: "REQUIRE_APPROVAL",
          skill_id: "codex_skill:repo:agents-skills-source-command-ecommerce-refund-money",
          missing_checks: ["custom_evidence_1"]
        });

        const run = await prisma.skillRun.findUniqueOrThrow({
          where: { id: decision.json().run_id },
          include: { gateCheckResults: true }
        });
        expect(run.resolvedSkillSnapshot).toMatchObject({
          resolver_source: "imported_registry",
          matched_field: "name",
          source_fingerprint: {
            source_type: "codex_skill",
            path: ".agents/skills/source-command-ecommerce-refund-money/SKILL.md"
          }
        });
        expect(run.gateCheckResults.map((check) => check.checkKey)).toEqual(["custom_evidence_1"]);
      } finally {
        await app.close();
      }
    });
  });

  it("maps short source-command requested_skill aliases to imported source-command skills", async () => {
    await withTempWorkspace(async (workspace) => {
      await createCustomerOptOutCommand(workspace);
      await createSourceCommandCustomerOptOutSkill(workspace);
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["privacy-team"],
            approver_roles: ["privacy-owner"]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "mcp_proxy",
            adapter_type: "mcp_proxy",
            agent: {
              agent_id: "mcp_customer_opt_out_source_command_test",
              agent_type: "mcp_proxy",
              role: "privacy_agent"
            },
            tool: {
              tool_name: "agentgate_govern_action"
            },
            raw_action: "trigger ecommerce-customer-opt-out",
            context: {
              environment: "production",
              requested_skill: "ecommerce-customer-opt-out",
              user_intent: "Trigger the ecommerce customer opt-out process"
            }
          }
        });
        expect(decision.statusCode).toBe(200);
        expect(decision.json()).toMatchObject({
          decision: "REQUIRE_APPROVAL",
          skill_id: "codex_skill:repo:agents-skills-source-command-ecommerce-customer-opt-out",
          missing_checks: ["custom_evidence_10"]
        });

        const run = await prisma.skillRun.findUniqueOrThrow({
          where: { id: decision.json().run_id },
          include: { gateCheckResults: true }
        });
        expect(run.resolvedSkillSnapshot).toMatchObject({
          resolver_source: "imported_registry",
          matched_field: "name",
          source_fingerprint: {
            source_type: "codex_skill",
            path: ".agents/skills/source-command-ecommerce-customer-opt-out/SKILL.md"
          }
        });
        expect(run.gateCheckResults.map((check) => check.checkKey)).toEqual(["custom_evidence_10"]);
      } finally {
        await app.close();
      }
    });
  });

  it("attaches reusable read-only evidence skills without repeating task instructions", async () => {
    await withTempWorkspace(async (workspace) => {
      await createRefundMoneyCommandWithAttachedEvidence(workspace);
      const tenantId = createdTenantIds.at(-1)!;
      const workspaceId = workspaceIdForTenant(tenantId);
      await createReusableCustomerEvidenceSkill(tenantId, workspaceId);
      const app = await createApp({ prisma, logger: false });
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
        expect(importResponse.statusCode).toBe(201);
        const candidate = importResponse.json().import_batch.candidates.find((entry: { name: string }) => entry.name === "refund-money");
        expect(candidate.evidence_tasks).toEqual([
          expect.objectContaining({
            check_key: "customer_file_not_empty",
            evidence_skill_id: "verify-customer-file",
            instructions: "",
            allowed_actions: []
          })
        ]);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"],
            candidate_reviews: [
              {
                candidate_id: candidate.candidate_id,
                policy_aliases: ["deploy-production"],
                evidence_tasks: candidate.evidence_tasks
              }
            ]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const importedSkill = await prisma.skill.findFirstOrThrow({
          where: {
            tenantId,
            workspaceId,
            skillId: "claude_command:repo:claude-commands-ecommerce-refund-money"
          }
        });

        const updateResponse = await app.inject({
          method: "POST",
          url: `/api/v1/skills/${encodeURIComponent(importedSkill.id)}/evidence-tasks`,
          payload: {
            evidence_tasks: [
              {
                check_key: "customer_file_not_empty",
                label: "Customer file is present",
                evidence_skill_id: "verify-customer-file"
              }
            ]
          }
        });
        expect(updateResponse.statusCode).toBe(201);
        expect(updateResponse.json().skill_version.evidence_tasks).toEqual([
          expect.objectContaining({
            check_key: "customer_file_not_empty",
            evidence_skill_id: "verify-customer-file"
          })
        ]);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "claude-code",
            adapter_type: "hook",
            agent: {
              agent_id: "claude_refund_attach_test",
              agent_type: "claude_code",
              role: "release_agent"
            },
            tool: {
              tool_name: "Bash"
            },
            raw_action: "refund money using refund-money",
            context: {
              environment: "production",
              requested_skill: "refund-money"
            }
          }
        });
        expect(decision.statusCode).toBe(200);

        const evidenceTask = await prisma.evidenceTask.findFirstOrThrow({
          where: {
            skillRunId: decision.json().run_id,
            checkKey: "customer_file_not_empty"
          }
        });
        expect(evidenceTask.evidenceSkillId).toBe("verify-customer-file");
        const taskInput = evidenceTask.input as Record<string, unknown>;
        expect(taskInput.evidence_task).toMatchObject({
          check_key: "customer_file_not_empty",
          evidence_skill_id: "verify-customer-file"
        });
        expect(taskInput.instruction).toBe("Read customer.md and confirm it exists and is not empty.");
        expect(taskInput.evidence_skill).toMatchObject({
          skill_id: "verify-customer-file",
          execution_snapshot: expect.objectContaining({
            body: "Read customer.md and confirm it exists and is not empty."
          })
        });
      } finally {
        await app.close();
      }
    });
  });

  it("uses active skill-version evidence tasks for static fallback skills", async () => {
    const tenantId = createdTenantIds.at(-1)!;
    const workspaceId = workspaceIdForTenant(tenantId);
    await prisma.skill.create({
      data: {
        id: `skill_static_deploy_${tenantId.replace(/[^a-zA-Z0-9]/g, "_")}`,
        tenantId,
        workspaceId,
        skillId: "deploy-production",
        name: "Deploy Production",
        category: "deployment",
        defaultRiskLevel: "high",
        description: "Deploy Production demo skill",
        versions: {
          create: {
            id: `skillver_static_deploy_${tenantId.replace(/[^a-zA-Z0-9]/g, "_")}`,
            tenantId,
            workspaceId,
            version: "evidence-test",
            config: {
              fixture: true,
              skill_type: "execution",
              side_effect_level: "mutating",
              required_checks: ["custom_evidence_1"],
              evidence_tasks: [
                {
                  check_key: "custom_evidence_1",
                  label: "Custom evidence 1",
                  instructions: "Read verified.md and confirm it exists and contains \"Run Tests successfully\".",
                  success_criteria: [],
                  allowed_actions: ["read_file"],
                  target_files: ["verified.md"]
                }
              ]
            },
            execution: {}
          }
        }
      }
    });

    const app = await createApp({ prisma, logger: false });
    try {
      const decision = await app.inject({
        method: "POST",
        url: "/api/v1/decision",
        payload: {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          source: "codex",
          adapter_type: "hook",
          agent: {
            agent_id: "codex_static_fallback_test",
            agent_type: "codex",
            role: "release_agent"
          },
          tool: {
            tool_name: "Bash"
          },
          raw_action: "vercel deploy --prod",
          context: {
            environment: "production",
            service: "checkout-api"
          }
        }
      });
      expect(decision.statusCode).toBe(200);

      const run = await prisma.skillRun.findUniqueOrThrow({
        where: { id: decision.json().run_id },
        include: {
          gateCheckResults: true,
          evidenceTasks: true
        }
      });
      expect(run.resolvedSkillSnapshot).toMatchObject({
        skill_id: "deploy-production",
        skill_version: "evidence-test",
        evidence_tasks: [
          expect.objectContaining({
            check_key: "custom_evidence_1",
            instructions: "Read verified.md and confirm it exists and contains \"Run Tests successfully\"."
          })
        ]
      });
      expect(run.policySnapshot).toMatchObject({
        required_checks: expect.arrayContaining([
          "ci_passed",
          "tests_passed",
          "rollback_plan_exists",
          "staging_deploy_successful",
          "custom_evidence_1"
        ])
      });
      expect(run.gateCheckResults.map((check) => check.checkKey)).toEqual(expect.arrayContaining(["custom_evidence_1"]));
      const customTask = run.evidenceTasks.find((task) => task.checkKey === "custom_evidence_1");
      expect(customTask?.input).toMatchObject({
        evidence_task: expect.objectContaining({
          check_key: "custom_evidence_1",
          target_files: ["verified.md"]
        }),
        instruction: "Read verified.md and confirm it exists and contains \"Run Tests successfully\"."
      });
    } finally {
      await app.close();
    }
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
        const simulationBody = simulation.json();
        expect(simulationBody.registry_resolution.imported_selected.skill_id).toContain("skill-001");
        expect(simulationBody.registry_resolution.imported_selected.name).toBe("Imported Skill 1");
        expect(simulationBody.resolved_skill.name).toBe("Imported Skill 1");

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload
        });
        expect(decision.statusCode).toBe(200);
        const decisionBody = decision.json();
        expect(decisionBody.skill_id).toContain("skill-001");
        expect(decisionBody.skill_version).toMatch(/^import-[a-f0-9]{12}$/);
        expect(decisionBody.risk_level).toBe("critical");
        expect(decisionBody.decision).toBe("REQUIRE_APPROVAL");
        await markGateChecksPassed(decisionBody.run_id);

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

  it("does not let an unrelated imported Claude command downgrade production deploy governance", async () => {
    await withTempWorkspace(async (workspace) => {
      await createCustomerOptOutCommand(workspace);
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["privacy_owner"],
            approver_roles: ["privacy_owner"]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "mcp_proxy",
            adapter_type: "mcp_proxy",
            agent: {
              agent_id: "agent_code_001",
              agent_type: "coding_agent",
              role: "release_agent"
            },
            tool: {
              tool_name: "vercel deploy --prod"
            },
            raw_action: 'vercel deploy --prod({"service":"checkout-api"})',
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
        const body = decision.json();
        expect(body.skill_id).toBe("deploy-production");
        expect(body.decision).toBe("REQUIRE_APPROVAL");
        expect(body.risk_level).toBe("critical");
      } finally {
        await app.close();
      }
    });
  });

  it("resolves an MCP production deploy to an imported Claude command when service context matches the command namespace", async () => {
    await withTempWorkspace(async (workspace) => {
      await createEcommerceProdDeploymentCommand(workspace);
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
            root_dir: workspace
          }
        });
        expect(importResponse.statusCode).toBe(201);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["service_owner"],
            approver_roles: ["service_owner"]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "mcp_proxy",
            adapter_type: "mcp_proxy",
            agent: {
              agent_id: "agent_code_001",
              agent_type: "coding_agent",
              role: "release_agent"
            },
            tool: {
              tool_name: "vercel deploy --prod"
            },
            raw_action: 'vercel deploy --prod({"service":"ecommerce"})',
            context: {
              repo: "agentgate",
              service: "ecommerce",
              environment: "production",
              ci_status: "passed",
              tests_status: "passed",
              rollback_plan: "exists",
              staging_deploy: "success"
            }
          }
        });

        expect(decision.statusCode).toBe(200);
        const body = decision.json();
        expect(body.skill_id).toBe("claude_command:repo:claude-commands-ecommerce-prod-deployment");
        expect(body.risk_level).toBe("critical");
        expect(body.missing_checks).toEqual(
          expect.arrayContaining(["ci_passed", "tests_passed", "rollback_plan_exists", "staging_deploy_successful", "security_scan_passed"])
        );
        const run = await prisma.skillRun.findUniqueOrThrow({
          where: { id: body.run_id },
          include: {
            gateCheckResults: true,
            evidenceTasks: true,
            approvalRequest: true
          }
        });
        expect(run.resolvedSkillSnapshot).toMatchObject({
          resolver_source: "imported_registry",
          policy_aliases: ["deploy-production"],
          required_checks: ["tests_passed", "security_scan_passed"],
          source_fingerprint: {
            source_type: "claude_command",
            path: ".claude/commands/ecommerce/prod-deployment.md"
          }
        });
        expect(run.policySnapshot).toMatchObject({
          matched_policy_id: "production_deploy_requires_approval",
          policy_required_checks: ["ci_passed", "tests_passed", "rollback_plan_exists", "staging_deploy_successful"],
          imported_required_checks: ["tests_passed", "security_scan_passed"],
          required_checks: ["ci_passed", "tests_passed", "rollback_plan_exists", "staging_deploy_successful", "security_scan_passed"]
        });
        expect(run.gateCheckResults.map((check) => check.checkKey).sort()).toEqual([
          "ci_passed",
          "rollback_plan_exists",
          "security_scan_passed",
          "staging_deploy_successful",
          "tests_passed"
        ]);
        expect(run.evidenceTasks.map((task) => task.checkKey).sort()).toEqual([
          "ci_passed",
          "rollback_plan_exists",
          "security_scan_passed",
          "staging_deploy_successful",
          "tests_passed"
        ]);
        expect(run.approvalRequest?.approvalReadiness).toBe("collecting");
        const blockedApproval = await app.inject({
          method: "POST",
          url: `/api/v1/approvals/${run.approvalRequest!.id}/approve`,
          payload: {
            comment: "Evidence is not done yet."
          }
        });
        expect(blockedApproval.statusCode).toBe(400);
        expect(blockedApproval.json().missing_checks).toEqual(expect.arrayContaining(["security_scan_passed"]));

        await markGateChecksPassed(body.run_id);
        const missingComment = await app.inject({
          method: "POST",
          url: `/api/v1/approvals/${run.approvalRequest!.id}/approve`,
          payload: {}
        });
        expect(missingComment.statusCode).toBe(400);
        expect(missingComment.json().error).toContain("Critical approvals require");

        const approved = await app.inject({
          method: "POST",
          url: `/api/v1/approvals/${run.approvalRequest!.id}/approve`,
          payload: {
            comment: "Production deploy evidence reviewed."
          }
        });
        expect(approved.statusCode).toBe(200);
        expect(body.decision).toBe("REQUIRE_APPROVAL");
      } finally {
        await app.close();
      }
    });
  });

  it("resolves natural-language Claude requests to matching imported Claude commands", async () => {
    await withTempWorkspace(async (workspace) => {
      await createDestroyEnvironmentCommand(workspace);
      const tenantId = createdTenantIds.at(-1)!;
      const workspaceId = workspaceIdForTenant(tenantId);
      const app = await createApp({ prisma, logger: false });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

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
        expect(importResponse.statusCode).toBe(201);

        const approveResponse = await app.inject({
          method: "POST",
          url: `/api/v1/registry/import-batches/${importResponse.json().import_batch.id}/approve`,
          payload: {
            owners: ["infra_owner"],
            approver_roles: ["infra_owner"]
          }
        });
        expect(approveResponse.statusCode).toBe(200);

        const decision = await app.inject({
          method: "POST",
          url: "/api/v1/decision",
          payload: {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            source: "claude_code",
            adapter_type: "hook",
            agent: {
              agent_id: "agent_code_001",
              agent_type: "claude_code",
              role: "release_agent"
            },
            tool: {
              tool_name: "Bash"
            },
            raw_action: "trigger destroy cloud environment resources",
            context: {
              repo: "agentgate",
              environment: "production"
            }
          }
        });

        expect(decision.statusCode).toBe(200);
        const body = decision.json();
        expect(body.skill_id).toBe("claude_command:repo:claude-commands-infrastructure-destroy-environment");
        expect(body.decision).toBe("REQUIRE_APPROVAL");
        expect(body.risk_level).toBe("critical");
        expect(body.missing_checks).toEqual(expect.arrayContaining(["backup_exists", "management_approval_token"]));

        const run = await prisma.skillRun.findUniqueOrThrow({
          where: { id: body.run_id },
          include: {
            gateCheckResults: true,
            evidenceTasks: true
          }
        });
        expect(run.resolvedSkillSnapshot).toMatchObject({
          resolver_source: "imported_registry",
          matched_field: "name",
          source_fingerprint: {
            source_type: "claude_command",
            path: ".claude/commands/infrastructure/destroy-environment.md"
          }
        });
        expect(run.gateCheckResults.map((check) => check.checkKey).sort()).toEqual(["backup_exists", "management_approval_token"]);
        expect(run.evidenceTasks.map((task) => task.checkKey).sort()).toEqual(["backup_exists", "management_approval_token"]);

        const mcpResult = await callAgentGateTool(
          "agentgate_govern_action",
          {
            raw_action: "trigger destroy cloud environment resources",
            environment: "production"
          },
          {
            apiBaseUrl: baseUrl,
            tenantId,
            workspaceId,
            timeoutMs: 5000
          }
        );
        const mcpPayload = JSON.parse(mcpResult.content[0]?.text ?? "{}");
        expect(mcpResult.isError).toBe(true);
        expect(mcpPayload.agentgate.skill_id).toBe("claude_command:repo:claude-commands-infrastructure-destroy-environment");
        expect(mcpPayload.agentgate.decision).toBe("REQUIRE_APPROVAL");
        expect(mcpPayload.agentgate.missing_checks).toEqual(expect.arrayContaining(["backup_exists", "management_approval_token"]));
      } finally {
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

async function createCustomerOptOutCommand(workspace: string) {
  const commandDir = join(workspace, ".claude", "commands", "ecommerce");
  await mkdir(commandDir, { recursive: true });
  await writeFile(
    join(commandDir, "customer-opt-out.md"),
    [
      "---",
      "name: customer-opt-out",
      "description: Handle consumer privacy request to opt out and erase personal information under GDPR/CCPA.",
      "allowed-tools: Bash(echo:*)",
      "owners: privacy-team",
      "approver_roles: privacy-owner",
      "---",
      "",
      "Opt out a customer from analytics tracking."
    ].join("\n"),
    "utf8"
  );
}

async function createRefundMoneyCommand(workspace: string) {
  const commandDir = join(workspace, ".claude", "commands", "ecommerce");
  await mkdir(commandDir, { recursive: true });
  await writeFile(
    join(commandDir, "refund-money.md"),
    [
      "---",
      "name: refund-money",
      "description: Refund customer money after approval.",
      "allowed-tools:",
      "  - Bash(echo:*)",
      "owners: support-team",
      "approver_roles: finance-owner",
      "evidence_tasks:",
      "  - check_key: customer_file_not_empty",
      "    label: Customer file is present",
      "    instructions: Read customer.md and confirm it exists and is not empty.",
      "    success_criteria:",
      "      - customer.md exists",
      "      - customer.md has non-whitespace content",
      "    allowed_actions:",
      "      - read_file",
      "    target_files:",
      "      - customer.md",
      "---",
      "",
      "Refund customer money after AgentGate approval."
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(workspace, "customer.md"), "customer_id: cust_123\n", "utf8");
}

async function createSourceCommandRefundMoneySkill(workspace: string) {
  const skillDir = join(workspace, ".agents", "skills", "source-command-ecommerce-refund-money");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: source-command-ecommerce-refund-money",
      "description: Process financial refunds for merchant/customer orders in staging and production environments.",
      "evidence_tasks:",
      "  - check_key: custom_evidence_1",
      "    label: Custom evidence 1",
      "    instructions: Read consent.md and confirm it exists and is not empty.",
      "    allowed_actions:",
      "      - read_file",
      "    target_files:",
      "      - consent.md",
      "---",
      "",
      "# source-command-ecommerce-refund-money",
      "",
      "Use this skill when the user asks to run the migrated source command `ecommerce-refund-money`.",
      "",
      "```bash",
      "echo \"This refund-money got executed\" >> ecommerce_operations.log",
      "```"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(workspace, "consent.md"), "consent given\n", "utf8");
}

async function createSourceCommandCustomerOptOutSkill(workspace: string) {
  const skillDir = join(workspace, ".agents", "skills", "source-command-ecommerce-customer-opt-out");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: source-command-ecommerce-customer-opt-out",
      "description: Handle consumer privacy request to opt out and erase personal information under GDPR/CCPA.",
      "owners:",
      "  - privacy-team",
      "approver_roles:",
      "  - privacy-owner",
      "evidence_tasks:",
      "  - check_key: custom_evidence_10",
      "    label: Custom evidence 10",
      "    instructions: If consent.md file is not empty return passed, else failed",
      "    allowed_actions:",
      "      - read_file",
      "    target_files:",
      "      - consent.md",
      "---",
      "",
      "# source-command-ecommerce-customer-opt-out",
      "",
      "Use this skill when the user asks to run the migrated source command `ecommerce-customer-opt-out`.",
      "",
      "```bash",
      "echo \"This customer-opt-out got executed\" >> ecommerce_operations.log",
      "```"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(workspace, "consent.md"), "consent given\n", "utf8");
}

async function createRefundMoneyCommandWithAttachedEvidence(workspace: string) {
  const commandDir = join(workspace, ".claude", "commands", "ecommerce");
  await mkdir(commandDir, { recursive: true });
  await writeFile(
    join(commandDir, "refund-money.md"),
    [
      "---",
      "name: refund-money",
      "description: Refund customer money after approval.",
      "allowed-tools:",
      "  - Bash(echo:*)",
      "owners: support-team",
      "approver_roles: finance-owner",
      "evidence_tasks:",
      "  - check_key: customer_file_not_empty",
      "    label: Customer file is present",
      "    evidence_skill_id: verify-customer-file",
      "---",
      "",
      "Refund customer money after AgentGate approval."
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(workspace, "customer.md"), "customer_id: cust_123\n", "utf8");
}

async function createReusableCustomerEvidenceSkill(tenantId: string, workspaceId: string) {
  await prisma.skill.create({
    data: {
      id: `skill_verify_customer_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      tenantId,
      workspaceId,
      skillId: "verify-customer-file",
      name: "Verify Customer File",
      category: "evidence",
      defaultRiskLevel: "low",
      versions: {
        create: {
          id: `skillver_verify_customer_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId,
          workspaceId,
          version: "1.0.0",
          config: {
            skill_type: "evidence",
            side_effect_level: "read_only",
            check_key: "customer_file_not_empty",
            allowed_runtimes: ["codex_cli", "claude_code_mcp", "local_deterministic"],
            preferred_runtimes: ["codex_cli", "local_deterministic"],
            execution_snapshot: {
              body: "Read customer.md and confirm it exists and is not empty."
            }
          },
          execution: {
            live_requires_execution_token: false
          }
        }
      }
    }
  });
}

async function createEcommerceProdDeploymentCommand(workspace: string) {
  const commandDir = join(workspace, ".claude", "commands", "ecommerce");
  await mkdir(commandDir, { recursive: true });
  await writeFile(
    join(commandDir, "prod-deployment.md"),
    [
      "---",
      "name: prod-deployment",
      "description: Execute production deployment of e-commerce checkout and catalog microservices.",
      "allowed-tools:",
      "  - Bash(vercel deploy:*)",
      "owners: devops-team",
      "approver_roles: release-manager",
      "required_evidence:",
      "  - automated-testing-report",
      "  - security-scan",
      "---",
      "",
      "Execute the ecommerce production deployment after AgentGate approval.",
      "",
      "```bash",
      "echo \"This prod-deployment got executed\" >> ecommerce_operations.log",
      "```"
    ].join("\n"),
    "utf8"
  );
}

async function createDestroyEnvironmentCommand(workspace: string) {
  const commandDir = join(workspace, ".claude", "commands", "infrastructure");
  await mkdir(commandDir, { recursive: true });
  await writeFile(
    join(commandDir, "destroy-environment.md"),
    [
      "---",
      "name: destroy-environment",
      "description: Tear down completely and destroy cloud environment resources using Terraform.",
      "allowed-tools:",
      "  - Bash(terraform destroy:*)",
      "  - Bash(echo:*)",
      "owners: infra-team",
      "approver_roles: infra-owner",
      "required_evidence:",
      "  - management-approval-token",
      "  - backup-exists",
      "---",
      "",
      "Destroy cloud environment resources after AgentGate approval."
    ].join("\n"),
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


async function markGateChecksPassed(runId: string) {
  await prisma.gateCheckResult.updateMany({
    where: { skillRunId: runId },
    data: {
      status: "passed",
      evidence: {
        source: "test",
        status: "passed"
      }
    }
  });
  await prisma.approvalRequest.update({
    where: { skillRunId: runId },
    data: {
      approvalReadiness: "ready",
      missingChecks: []
    }
  });
}
