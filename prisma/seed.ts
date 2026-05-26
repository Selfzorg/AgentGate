import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadDemoFixtures } from "@agentgate/config-loader";

const prisma = new PrismaClient();

function prismaAgentSource(source: string) {
  return source === "claude_code" || source === "claude-code" ? "claude_code" : source;
}

async function cleanDatabase() {
  await prisma.$transaction([
    prisma.auditArtifact.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.skillRunAttempt.deleteMany(),
    prisma.dryRunResult.deleteMany(),
    prisma.executionLog.deleteMany(),
    prisma.executionToken.deleteMany(),
    prisma.approvalRequest.deleteMany(),
    prisma.gateCheckResult.deleteMany(),
    prisma.skillRun.deleteMany(),
    prisma.policyVersion.deleteMany(),
    prisma.policy.deleteMany(),
    prisma.skillVersion.deleteMany(),
    prisma.skill.deleteMany(),
    prisma.connector.deleteMany(),
    prisma.agent.deleteMany(),
    prisma.user.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.tenant.deleteMany()
  ]);
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fixtures = await loadDemoFixtures(join(repoRoot, "configs"));

  await cleanDatabase();

  const tenant = await prisma.tenant.create({
    data: {
      id: fixtures.agents.tenant.id,
      name: fixtures.agents.tenant.name
    }
  });

  const workspace = await prisma.workspace.create({
    data: {
      id: fixtures.agents.workspace.id,
      tenantId: tenant.id,
      key: fixtures.agents.workspace.key,
      name: fixtures.agents.workspace.name
    }
  });

  for (const user of fixtures.agents.users) {
    await prisma.user.create({
      data: {
        id: user.id,
        tenantId: tenant.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  }

  for (const agent of fixtures.agents.agents) {
    await prisma.agent.create({
      data: {
        id: agent.id,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        ownerUserId: agent.owner_user_id,
        externalAgentId: agent.external_agent_id,
        source: prismaAgentSource(agent.source) as never,
        agentType: agent.agent_type,
        role: agent.role,
        displayName: agent.display_name,
        metadata: {
          fixture: true
        }
      }
    });
  }

  for (const connector of fixtures.skills.connectors) {
    await prisma.connector.create({
      data: {
        id: connector.id,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        connectorId: connector.connector_id,
        name: connector.name,
        type: connector.type,
        config: {
          fixture: true,
          side_effects: "simulated"
        }
      }
    });
  }

  const skillRecordIds = new Map<string, string>();
  for (const skill of fixtures.skills.skills) {
    const skillRecord = await prisma.skill.create({
      data: {
        id: skill.id,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        skillId: skill.skill_id,
        name: skill.name,
        category: skill.category,
        defaultRiskLevel: skill.default_risk_level,
        description: `${skill.name} demo skill`
      }
    });

    skillRecordIds.set(skill.skill_id, skillRecord.id);

    await prisma.skillVersion.create({
      data: {
        id: `${skill.id}_v${skill.version.replaceAll(".", "_")}`,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        skillRecordId: skillRecord.id,
        connectorId: skill.connector_id,
        version: skill.version,
        config: {
          fixture: true,
          supports_dry_run: Boolean(skill.supports_dry_run)
        },
        execution: {
          live_requires_execution_token: skill.live_requires_execution_token
        }
      }
    });
  }

  for (const rule of fixtures.policies.rules) {
    const policy = await prisma.policy.create({
      data: {
        id: `policy_${rule.policy_id}`,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        policyId: rule.policy_id,
        name: rule.name
      }
    });

    await prisma.policyVersion.create({
      data: {
        id: `policy_version_${rule.policy_id}_v1`,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        policyRecordId: policy.id,
        version: "1.0.0",
        priority: rule.priority,
        decision: rule.decision,
        reason: rule.reason,
        definition: {
          when: rule.when,
          matched_skill_record_id:
            typeof rule.when.skill === "string" ? skillRecordIds.get(rule.when.skill) : null
        } as Prisma.InputJsonValue,
        requiredChecks: (rule.required_checks ?? []) as Prisma.InputJsonValue,
        approvers: (rule.approvers ?? []) as Prisma.InputJsonValue
      }
    });
  }

  console.log(
    `Seeded ${tenant.id}/${workspace.id}: ${fixtures.agents.users.length} users, ${fixtures.agents.agents.length} agents, ${fixtures.skills.skills.length} skills, ${fixtures.policies.rules.length} policies.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
