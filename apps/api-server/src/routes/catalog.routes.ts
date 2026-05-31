import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeEvidenceTaskSpecs, type SkillEvidenceTaskSpec } from "@agentgate/skill-registry";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { emitAuditEvent } from "../services/audit-event-service";
import { validateEvidenceTaskAttachments } from "../services/evidence-skill-registry";
import { createId } from "../services/id";
import {
  exportPolicyPack,
  importPolicyPack,
  listPolicyPacks,
  serializePolicyWithVersion,
  setPolicyStatus,
  upsertPolicyRule
} from "../services/policy-registry-service";

const skillsQuerySchema = z.object({
  source: z.string().optional(),
  include_inactive: z.enum(["true", "false"]).optional()
});

const skillVersionParamsSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1)
});

const skillParamsSchema = z.object({
  id: z.string().min(1)
});

const evidenceTaskSchema = z.object({
  check_key: z.string().min(1),
  label: z.string().min(1),
  evidence_skill_id: z.string().min(1).optional(),
  instructions: z.string().optional(),
  success_criteria: z.array(z.string().min(1)).optional(),
  allowed_actions: z.array(z.string().min(1)).optional(),
  target_files: z.array(z.string().min(1)).optional()
});

const updateEvidenceTasksSchema = z.object({
  evidence_tasks: z.array(evidenceTaskSchema),
  updated_by: z.string().min(1).optional()
});

const updatePolicyBindingsSchema = z.object({
  policy_aliases: z.array(z.string()),
  updated_by: z.string().min(1).optional()
});

const tenantWorkspaceQuerySchema = z.object({
  tenant_id: z.string().min(1).default("tenant_demo"),
  workspace_id: z.string().min(1).default("workspace_demo")
});

const policyQuerySchema = tenantWorkspaceQuerySchema.extend({
  include_inactive: z.enum(["true", "false"]).optional()
});

const policyParamsSchema = z.object({
  id: z.string().min(1)
});

const policyRuleSchema = z.object({
  tenant_id: z.string().min(1).default("tenant_demo"),
  workspace_id: z.string().min(1).default("workspace_demo"),
  policy_id: z.string().min(1),
  name: z.string().min(1),
  priority: z.number().int(),
  decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"]),
  reason: z.string().min(1),
  when: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, "Policy must include at least one when condition."),
  required_checks: z.array(z.string()).optional(),
  approvers: z.array(z.string()).optional(),
  updated_by: z.string().min(1).optional()
});

const policyPackParamsSchema = z.object({
  pack_id: z.string().min(1)
});

const policyPackImportSchema = z.object({
  tenant_id: z.string().min(1).default("tenant_demo"),
  workspace_id: z.string().min(1).default("workspace_demo"),
  pack_id: z.string().min(1),
  name: z.string().min(1),
  scope: z.enum(["org", "workspace", "repo"]).optional(),
  source: z.string().min(1).optional(),
  rollout_mode: z.enum(["observe", "warn", "enforce"]).optional(),
  imported_by: z.string().min(1).optional(),
  rules: z.array(
    z.object({
      policy_id: z.string().min(1),
      name: z.string().min(1),
      priority: z.number().int(),
      when: z.record(z.unknown()),
      decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"]),
      reason: z.string().min(1),
      required_checks: z.array(z.string()).optional(),
      approvers: z.array(z.string()).optional()
    })
  )
});

export const registerCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/skills", async (request) => {
    const query = skillsQuerySchema.parse(request.query);
    const [skills, activePolicies] = await Promise.all([
      app.services.prisma.skill.findMany({
        where: query.include_inactive === "true" ? {} : { status: "active" },
        include: {
          versions: {
            orderBy: { createdAt: "desc" },
            include: {
              connector: true
            }
          }
        },
        orderBy: [{ category: "asc" }, { skillId: "asc" }]
      }),
      app.services.prisma.policy.findMany({
        where: { status: "active" },
        include: {
          versions: {
            where: { status: "active" },
            orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
            take: 1
          }
        },
        orderBy: { policyId: "asc" }
      })
    ]);
    const policySummaries = activePolicies.flatMap((policy) => {
      const version = policy.versions[0];
      return version ? [serializePolicyWithVersion(policy, version)] : [];
    });
    const filteredSkills = query.source
      ? skills.filter((skill) => skill.versions.some((version) => sourceTypeFromConfig(version.config) === query.source))
      : skills;

    return {
      skills: filteredSkills.map((skill) => {
        const version = skill.versions.find((candidate) => candidate.status === "active") ?? skill.versions[0];
        const config = recordFrom(version?.config);
        const policyAliases = stringArray(config.policy_aliases);
        return {
          id: skill.id,
          skill_id: skill.skillId,
          name: skill.name,
          category: skill.category,
          default_risk_level: skill.defaultRiskLevel,
          description: skill.description,
          status: skill.status,
          version: version?.version ?? "unknown",
          version_status: version?.status ?? "archived",
          connector: version?.connector?.connectorId ?? null,
          config: version?.config ?? {},
          execution: version?.execution ?? {},
          evidence_tasks: normalizeEvidenceTaskSpecs(config.evidence_tasks).tasks,
          policy_aliases: policyAliases,
          matched_policies: matchedPoliciesForSkill(skill.skillId, policyAliases, policySummaries, {
            tenantId: skill.tenantId,
            workspaceId: skill.workspaceId
          })
        };
      })
    };
  });

  app.post("/skills/:id/evidence-tasks", async (request, reply) => {
    const params = skillParamsSchema.parse(request.params);
    const body = updateEvidenceTasksSchema.parse(request.body);
    const result = await updateSkillEvidenceTasks(app.services.prisma, {
      skillIdentifier: params.id,
      evidenceTasks: body.evidence_tasks.map((task) => ({
        check_key: task.check_key,
        label: task.label,
        evidence_skill_id: task.evidence_skill_id,
        instructions: task.instructions ?? "",
        success_criteria: task.success_criteria ?? [],
        allowed_actions: task.allowed_actions ?? [],
        target_files: task.target_files ?? []
      })),
      updatedBy: body.updated_by
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skills/:id/policy-bindings", async (request, reply) => {
    const params = skillParamsSchema.parse(request.params);
    const body = updatePolicyBindingsSchema.parse(request.body);
    const result = await updateSkillPolicyBindings(app.services.prisma, {
      skillIdentifier: params.id,
      policyAliases: body.policy_aliases,
      updatedBy: body.updated_by
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/skills/:id/versions/:version/enable", async (request, reply) => {
    const params = skillVersionParamsSchema.parse(request.params);
    const result = await setSkillVersionStatus(app.services.prisma, params.id, params.version, "active");
    return reply.code(result.status).send(result.body);
  });

  app.post("/skills/:id/versions/:version/disable", async (request, reply) => {
    const params = skillVersionParamsSchema.parse(request.params);
    const result = await setSkillVersionStatus(app.services.prisma, params.id, params.version, "inactive");
    return reply.code(result.status).send(result.body);
  });

  app.get("/policies", async (request) => {
    const query = policyQuerySchema.parse(request.query);
    const policies = await app.services.prisma.policy.findMany({
      where: {
        tenantId: query.tenant_id,
        workspaceId: query.workspace_id,
        ...(query.include_inactive === "true" ? {} : { status: "active" as const })
      },
      include: {
        versions: {
          where: { status: "active" },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          take: 1
        }
      },
      orderBy: { policyId: "asc" }
    });

    return {
      policies: policies.map((policy) => {
        const version = policy.versions[0];
        return serializePolicyWithVersion(policy, version ?? null);
      })
    };
  });

  app.post("/policies", async (request, reply) => {
    const body = policyRuleSchema.parse(request.body);
    const result = await upsertPolicyRule(app.services.prisma, {
      tenantId: body.tenant_id,
      workspaceId: body.workspace_id,
      policyId: body.policy_id,
      name: body.name,
      priority: body.priority,
      when: body.when,
      decision: body.decision,
      reason: body.reason,
      requiredChecks: body.required_checks,
      approvers: body.approvers,
      updatedBy: body.updated_by
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/policies/:id/disable", async (request, reply) => {
    const params = policyParamsSchema.parse(request.params);
    const query = tenantWorkspaceQuerySchema.parse(request.query);
    const result = await setPolicyStatus(app.services.prisma, {
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      policyIdentifier: params.id,
      status: "inactive"
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/policies/:id/enable", async (request, reply) => {
    const params = policyParamsSchema.parse(request.params);
    const query = tenantWorkspaceQuerySchema.parse(request.query);
    const result = await setPolicyStatus(app.services.prisma, {
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      policyIdentifier: params.id,
      status: "active"
    });
    return reply.code(result.status).send(result.body);
  });

  app.get("/policies/conflicts", async (request) => {
    const query = tenantWorkspaceQuerySchema.parse(request.query);
    const policies = await app.services.prisma.policy.findMany({
      where: {
        tenantId: query.tenant_id,
        workspaceId: query.workspace_id,
        status: "active"
      },
      include: {
        versions: {
          where: { status: "active" },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { policyId: "asc" }
    });

    return {
      conflicts: conflictReportForPolicies(
        policies.flatMap((policy) => {
          const version = policy.versions[0];
          return version
            ? [
                {
                  policy_id: policy.policyId,
                  name: policy.name,
                  version: version.version,
                  priority: version.priority,
                  decision: version.decision,
                  definition: version.definition
                }
              ]
            : [];
        })
      )
    };
  });

  app.get("/policy-packs", async (request) => {
    const query = tenantWorkspaceQuerySchema.parse(request.query);
    return listPolicyPacks(app.services.prisma, {
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id
    });
  });

  app.post("/policy-packs/import", async (request, reply) => {
    const body = policyPackImportSchema.parse(request.body);
    const result = await importPolicyPack(app.services.prisma, {
      tenantId: body.tenant_id,
      workspaceId: body.workspace_id,
      packId: body.pack_id,
      name: body.name,
      scope: body.scope,
      source: body.source,
      rolloutMode: body.rollout_mode,
      importedBy: body.imported_by,
      rules: body.rules
    });
    return reply.code(result.status).send(result.body);
  });

  app.get("/policy-packs/:pack_id/export", async (request, reply) => {
    const params = policyPackParamsSchema.parse(request.params);
    const query = tenantWorkspaceQuerySchema.parse(request.query);
    const result = await exportPolicyPack(app.services.prisma, {
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      packId: params.pack_id
    });
    return reply.code(result.status).send(result.body);
  });
};

async function setSkillVersionStatus(
  prisma: PrismaClient,
  skillIdentifier: string,
  version: string,
  status: "active" | "inactive"
) {
  const skill = await prisma.skill.findFirst({
    where: {
      OR: [{ id: skillIdentifier }, { skillId: skillIdentifier }]
    }
  });

  if (!skill) return { status: 404 as const, body: { error: "Skill not found" } };

  const skillVersion = await prisma.skillVersion.findUnique({
    where: {
      skillRecordId_version: {
        skillRecordId: skill.id,
        version
      }
    }
  });

  if (!skillVersion) return { status: 404 as const, body: { error: "Skill version not found" } };

  const updated = await prisma.$transaction(async (tx) => {
    const updatedVersion = await tx.skillVersion.update({
      where: { id: skillVersion.id },
      data: { status }
    });

    if (status === "active") {
      await tx.skill.update({
        where: { id: skill.id },
        data: { status: "active" }
      });
    } else {
      const activeVersionCount = await tx.skillVersion.count({
        where: {
          skillRecordId: skill.id,
          status: "active"
        }
      });
      if (activeVersionCount === 0) {
        await tx.skill.update({
          where: { id: skill.id },
          data: { status: "inactive" }
        });
      }
    }

    return updatedVersion;
  });

  return {
    status: 200 as const,
    body: {
      skill_version: {
        id: updated.id,
        skill_id: skill.skillId,
        version: updated.version,
        status: updated.status,
        config: updated.config,
        execution: updated.execution
      }
    }
  };
}

async function updateSkillEvidenceTasks(
  prisma: PrismaClient,
  input: {
    skillIdentifier: string;
    evidenceTasks: SkillEvidenceTaskSpec[];
    updatedBy?: string | undefined;
  }
) {
  const normalized = normalizeEvidenceTaskSpecs(input.evidenceTasks, { sourceLabel: "evidence_tasks" });
  if (normalized.warnings.length > 0 || normalized.tasks.length !== input.evidenceTasks.length) {
    return {
      status: 400 as const,
      body: {
        error: "Invalid evidence tasks",
        warnings: normalized.warnings
      }
    };
  }

  const skill = await prisma.skill.findFirst({
    where: {
      OR: [{ id: input.skillIdentifier }, { skillId: input.skillIdentifier }]
    },
    include: {
      versions: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!skill) return { status: 404 as const, body: { error: "Skill not found" } };
  const activeVersion = skill.versions[0];
  if (!activeVersion) return { status: 409 as const, body: { error: "Skill does not have an active version" } };

  const attachmentWarnings = await validateEvidenceTaskAttachments(prisma, {
    tenantId: skill.tenantId,
    workspaceId: skill.workspaceId,
    tasks: normalized.tasks
  });
  if (attachmentWarnings.length > 0) {
    return {
      status: 400 as const,
      body: {
        error: "Invalid evidence tasks",
        warnings: attachmentWarnings
      }
    };
  }

  const checkKeys = normalized.tasks.map((task) => task.check_key);
  const now = new Date();
  const nextVersion = `evidence-${createId("rev").replace(/^rev_/, "").slice(0, 12)}`;
  const nextConfig = {
    ...recordFrom(activeVersion.config),
    evidence_tasks: normalized.tasks,
    required_checks: checkKeys,
    evidence_review: {
      ...recordFrom(recordFrom(activeVersion.config).evidence_review),
      reviewed_required_checks: checkKeys,
      evidence_tasks: normalized.tasks,
      edited_at: now.toISOString(),
      edited_by: input.updatedBy ?? "user_service_owner",
      source: "skills_registry"
    }
  };

  const created = await prisma.$transaction(async (tx) => {
    await tx.skillVersion.updateMany({
      where: {
        skillRecordId: skill.id,
        status: "active"
      },
      data: { status: "inactive" }
    });

    const skillVersion = await tx.skillVersion.create({
      data: {
        id: createId("skillver"),
        tenantId: skill.tenantId,
        workspaceId: skill.workspaceId,
        skillRecordId: skill.id,
        connectorId: activeVersion.connectorId,
        version: nextVersion,
        status: "active",
        config: nextConfig as Prisma.InputJsonValue,
        execution: (activeVersion.execution ?? {}) as Prisma.InputJsonValue
      }
    });

    await tx.skill.update({
      where: { id: skill.id },
      data: { status: "active" }
    });

    await emitAuditEvent(tx, {
      tenantId: skill.tenantId,
      workspaceId: skill.workspaceId,
      traceId: createId("trc"),
      eventType: "skill.evidence_tasks.updated",
      actorType: "user",
      actorId: input.updatedBy ?? "user_service_owner",
      metadata: {
        skill_id: skill.skillId,
        previous_version: activeVersion.version,
        new_version: nextVersion,
        evidence_tasks: normalized.tasks
      }
    });

    return skillVersion;
  });

  return {
    status: 201 as const,
    body: {
      skill_version: {
        id: created.id,
        skill_id: skill.skillId,
        version: created.version,
        status: created.status,
        config: created.config,
        execution: created.execution,
        evidence_tasks: normalized.tasks
      }
    }
  };
}

async function updateSkillPolicyBindings(
  prisma: PrismaClient,
  input: {
    skillIdentifier: string;
    policyAliases: string[];
    updatedBy?: string | undefined;
  }
) {
  const policyAliases = uniqueStrings(input.policyAliases);
  const skill = await prisma.skill.findFirst({
    where: {
      OR: [{ id: input.skillIdentifier }, { skillId: input.skillIdentifier }]
    },
    include: {
      versions: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!skill) return { status: 404 as const, body: { error: "Skill not found" } };
  const activeVersion = skill.versions[0];
  if (!activeVersion) return { status: 409 as const, body: { error: "Skill does not have an active version" } };

  const activePolicies = await prisma.policy.findMany({
    where: {
      tenantId: skill.tenantId,
      workspaceId: skill.workspaceId,
      status: "active"
    },
    include: {
      versions: {
        where: { status: "active" },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    },
    orderBy: { policyId: "asc" }
  });
  const policySummaries = activePolicies.flatMap((policy) => {
    const version = policy.versions[0];
    return version ? [serializePolicyWithVersion(policy, version)] : [];
  });
  const targetKeys = new Set(policySummaries.flatMap(policyTargetKeys));
  const warnings = policyAliases
    .filter((alias) => !targetKeys.has(alias))
    .map((alias) => `Policy alias ${alias} does not match an active policy target.`);
  const currentAliases = stringArray(recordFrom(activeVersion.config).policy_aliases);
  const matchedPolicies = matchedPoliciesForSkill(skill.skillId, policyAliases, policySummaries, {
    tenantId: skill.tenantId,
    workspaceId: skill.workspaceId
  });

  if (arraysEqual(currentAliases, policyAliases)) {
    return {
      status: 200 as const,
      body: {
        skill_version: {
          id: activeVersion.id,
          skill_id: skill.skillId,
          version: activeVersion.version,
          status: activeVersion.status,
          config: activeVersion.config,
          execution: activeVersion.execution,
          policy_aliases: policyAliases,
          matched_policies: matchedPolicies
        },
        warnings,
        noop: true
      }
    };
  }

  const now = new Date();
  const nextVersion = `policy-${createId("rev").replace(/^rev_/, "").slice(0, 12)}`;
  const nextConfig = {
    ...recordFrom(activeVersion.config),
    policy_aliases: policyAliases,
    policy_review: {
      ...recordFrom(recordFrom(activeVersion.config).policy_review),
      policy_aliases: policyAliases,
      matched_policy_ids: matchedPolicies.map((policy) => policy.policy_id),
      warnings,
      edited_at: now.toISOString(),
      edited_by: input.updatedBy ?? "user_policy_admin",
      source: "skills_registry"
    }
  };

  const created = await prisma.$transaction(async (tx) => {
    await tx.skillVersion.updateMany({
      where: {
        skillRecordId: skill.id,
        status: "active"
      },
      data: { status: "inactive" }
    });

    const skillVersion = await tx.skillVersion.create({
      data: {
        id: createId("skillver"),
        tenantId: skill.tenantId,
        workspaceId: skill.workspaceId,
        skillRecordId: skill.id,
        connectorId: activeVersion.connectorId,
        version: nextVersion,
        status: "active",
        config: nextConfig as Prisma.InputJsonValue,
        execution: (activeVersion.execution ?? {}) as Prisma.InputJsonValue
      }
    });

    await tx.skill.update({
      where: { id: skill.id },
      data: { status: "active" }
    });

    await emitAuditEvent(tx, {
      tenantId: skill.tenantId,
      workspaceId: skill.workspaceId,
      traceId: createId("trc"),
      eventType: "skill.policy_bindings.updated",
      actorType: "user",
      actorId: input.updatedBy ?? "user_policy_admin",
      metadata: {
        skill_id: skill.skillId,
        previous_version: activeVersion.version,
        new_version: nextVersion,
        policy_aliases: policyAliases,
        matched_policy_ids: matchedPolicies.map((policy) => policy.policy_id),
        warnings
      }
    });

    return skillVersion;
  });

  return {
    status: 201 as const,
    body: {
      skill_version: {
        id: created.id,
        skill_id: skill.skillId,
        version: created.version,
        status: created.status,
        config: created.config,
        execution: created.execution,
        policy_aliases: policyAliases,
        matched_policies: matchedPolicies
      },
      warnings
    }
  };
}

function sourceTypeFromConfig(config: unknown): string | null {
  const record = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const source = record.source && typeof record.source === "object" && !Array.isArray(record.source) ? (record.source as Record<string, unknown>) : {};
  return typeof source.type === "string" ? source.type : null;
}

function conflictReportForPolicies(
  policies: Array<{
    policy_id: string;
    name: string;
    version: string;
    priority: number;
    decision: string;
    definition: unknown;
  }>
) {
  const groups = new Map<string, typeof policies>();
  for (const policy of policies) {
    const key = stableJson(recordFrom(policy.definition).when ?? policy.definition);
    const group = groups.get(key) ?? [];
    group.push(policy);
    groups.set(key, group);
  }

  return [...groups.entries()].flatMap(([condition_key, group]) => {
    const decisions = new Set(group.map((policy) => policy.decision));
    if (group.length <= 1) return [];
    return [
      {
        condition_key,
        severity: decisions.size > 1 ? "conflict" : "shadow",
        policies: group
      }
    ];
  });
}

type SerializedPolicy = ReturnType<typeof serializePolicyWithVersion>;

function matchedPoliciesForSkill(
  skillId: string,
  policyAliases: string[],
  policies: SerializedPolicy[],
  scope: { tenantId: string; workspaceId: string }
) {
  const skillTargets = new Set([skillId, ...policyAliases]);
  return policies
    .filter((policy) => policy.tenant_id === scope.tenantId && policy.workspace_id === scope.workspaceId)
    .filter((policy) => policyTargetKeys(policy).some((target) => skillTargets.has(target)))
    .sort((left, right) => right.priority - left.priority);
}

function policyTargetKeys(policy: Pick<SerializedPolicy, "when">): string[] {
  const skill = recordFrom(policy.when).skill;
  if (typeof skill === "string" && skill.trim().length > 0) return [skill.trim()];
  if (Array.isArray(skill)) return stringArray(skill);
  return [];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => normalizedRight[index] === value);
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])));
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
