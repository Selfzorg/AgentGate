import { createHash } from "node:crypto";
import type { DemoPolicyRule } from "@agentgate/core-types";
import { Prisma, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createId } from "./id";
import { recordFrom } from "./object-utils";

export type PolicyPackImportInput = {
  tenantId: string;
  workspaceId: string;
  packId: string;
  name: string;
  scope?: "org" | "workspace" | "repo" | undefined;
  source?: string | undefined;
  rolloutMode?: "observe" | "warn" | "enforce" | undefined;
  rules: DemoPolicyRule[];
  importedBy?: string | undefined;
};

export type PolicyRuleUpsertInput = {
  tenantId: string;
  workspaceId: string;
  policyId: string;
  name: string;
  priority: number;
  when: Record<string, unknown>;
  decision: DemoPolicyRule["decision"];
  reason: string;
  requiredChecks?: string[] | undefined;
  approvers?: string[] | undefined;
  updatedBy?: string | undefined;
};

const UI_POLICY_PACK_ID = "ui-policy-pack";

export async function loadActivePolicyRules(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    fallbackRules: DemoPolicyRule[];
  }
): Promise<DemoPolicyRule[]> {
  const policies = await prisma.policy.findMany({
    where: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      status: "active"
    },
    include: {
      policyPack: true,
      versions: {
        where: { status: "active" },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    }
  });

  const dbRules = policies.flatMap((policy) => {
    const version = policy.versions[0];
    if (!version) return [];
    const definition = recordFrom(version.definition);
    const when = recordFrom(definition.when);
    if (Object.keys(when).length === 0) return [];

    return [
      {
        policy_id: policy.policyId,
        name: policy.name,
        priority: version.priority,
        when,
        decision: version.decision,
        reason: version.reason,
        required_checks: stringArray(version.requiredChecks),
        approvers: stringArray(version.approvers)
      } satisfies DemoPolicyRule
    ];
  });

  return dbRules.length > 0 ? dbRules : input.fallbackRules;
}

export async function upsertPolicyRule(prisma: PrismaClient, input: PolicyRuleUpsertInput) {
  const rule: DemoPolicyRule = {
    policy_id: input.policyId,
    name: input.name,
    priority: input.priority,
    when: input.when,
    decision: input.decision,
    reason: input.reason,
    required_checks: input.requiredChecks ?? [],
    approvers: input.approvers ?? []
  };
  const version = versionForPolicyRule(rule);
  const warnings = policyRuleWarnings(rule);

  const result = await prisma.$transaction(async (tx) => {
    const pack = await tx.policyPack.upsert({
      where: {
        tenantId_workspaceId_packId: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          packId: UI_POLICY_PACK_ID
        }
      },
      create: {
        id: createId("polpack"),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        packId: UI_POLICY_PACK_ID,
        name: "UI Policy Pack",
        scope: "workspace",
        source: "ui",
        config: { rollout_mode: "enforce" } as Prisma.InputJsonValue
      },
      update: {
        name: "UI Policy Pack",
        source: "ui",
        status: "active",
        config: { rollout_mode: "enforce" } as Prisma.InputJsonValue
      }
    });

    const policy = await tx.policy.upsert({
      where: {
        tenantId_workspaceId_policyId: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          policyId: input.policyId
        }
      },
      create: {
        id: createId("policy"),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        policyPackId: pack.id,
        policyId: input.policyId,
        name: input.name,
        status: "active"
      },
      update: {
        policyPackId: pack.id,
        name: input.name,
        status: "active"
      }
    });

    const activeVersion = await tx.policyVersion.findFirst({
      where: {
        policyRecordId: policy.id,
        status: "active"
      },
      orderBy: { createdAt: "desc" }
    });

    if (activeVersion?.version === version) {
      return { policy, version: activeVersion, created: false };
    }

    await tx.policyVersion.updateMany({
      where: {
        policyRecordId: policy.id,
        status: "active"
      },
      data: { status: "inactive" }
    });

    const createdVersion = await tx.policyVersion.create({
      data: {
        id: createId("polver"),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        policyRecordId: policy.id,
        version,
        priority: rule.priority,
        decision: rule.decision,
        reason: rule.reason,
        definition: {
          when: rule.when,
          pack_id: UI_POLICY_PACK_ID,
          pack_scope: "workspace",
          rollout_mode: "enforce",
          imported_from: "ui"
        } as Prisma.InputJsonValue,
        requiredChecks: (rule.required_checks ?? []) as Prisma.InputJsonValue,
        approvers: (rule.approvers ?? []) as Prisma.InputJsonValue,
        status: "active"
      }
    });

    await emitAuditEvent(tx, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      traceId: createId("trc"),
      eventType: "policy.updated",
      actorType: "user",
      actorId: input.updatedBy ?? "policy_admin",
      metadata: {
        policy_id: input.policyId,
        previous_version: activeVersion?.version ?? null,
        new_version: createdVersion.version,
        decision: rule.decision,
        when: rule.when
      }
    });

    return { policy, version: createdVersion, created: true };
  });

  return {
    status: result.created ? 201 as const : 200 as const,
    body: {
      policy: serializePolicyWithVersion(result.policy, result.version),
      warnings
    }
  };
}

export async function setPolicyStatus(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    policyIdentifier: string;
    status: "active" | "inactive";
    updatedBy?: string | undefined;
  }
) {
  const policy = await prisma.policy.findFirst({
    where: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      OR: [{ id: input.policyIdentifier }, { policyId: input.policyIdentifier }]
    },
    include: {
      versions: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!policy) return { status: 404 as const, body: { error: "Policy not found" } };
  if (input.status === "active" && policy.versions.length === 0) {
    return { status: 409 as const, body: { error: "Policy does not have an active version" } };
  }

  const updated = policy.status === input.status
    ? policy
    : await prisma.$transaction(async (tx) => {
        const next = await tx.policy.update({
          where: { id: policy.id },
          data: { status: input.status }
        });
        await emitAuditEvent(tx, {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          traceId: createId("trc"),
          eventType: input.status === "active" ? "policy.enabled" : "policy.disabled",
          actorType: "user",
          actorId: input.updatedBy ?? "policy_admin",
          metadata: {
            policy_id: policy.policyId,
            status: input.status
          }
        });
        return next;
      });

  return {
    status: 200 as const,
    body: {
      policy: serializePolicyWithVersion(updated, policy.versions[0] ?? null)
    }
  };
}

export async function listPolicyPacks(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
  }
) {
  const packs = await prisma.policyPack.findMany({
    where: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId
    },
    include: {
      policies: {
        include: {
          versions: {
            where: { status: "active" },
            orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
            take: 1
          }
        }
      }
    },
    orderBy: [{ scope: "asc" }, { packId: "asc" }]
  });

  return {
    policy_packs: packs.map(serializePolicyPack)
  };
}

export async function importPolicyPack(prisma: PrismaClient, input: PolicyPackImportInput) {
  const result = await prisma.$transaction(async (tx) => {
    const pack = await tx.policyPack.upsert({
      where: {
        tenantId_workspaceId_packId: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          packId: input.packId
        }
      },
      create: {
        id: createId("polpack"),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        packId: input.packId,
        name: input.name,
        scope: input.scope ?? "workspace",
        source: input.source ?? "api",
        config: {
          rollout_mode: input.rolloutMode ?? "enforce"
        } as Prisma.InputJsonValue
      },
      update: {
        name: input.name,
        scope: input.scope ?? "workspace",
        source: input.source ?? "api",
        status: "active",
        config: {
          rollout_mode: input.rolloutMode ?? "enforce"
        } as Prisma.InputJsonValue
      }
    });

    const imported: Array<{ policy_id: string; version: string; status: string }> = [];
    const skipped: Array<{ policy_id: string; version: string; reason: string }> = [];

    for (const rule of input.rules) {
      const version = versionForPolicyRule(rule);
      const policy = await tx.policy.upsert({
        where: {
          tenantId_workspaceId_policyId: {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            policyId: rule.policy_id
          }
        },
        create: {
          id: createId("policy"),
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          policyPackId: pack.id,
          policyId: rule.policy_id,
          name: rule.name,
          status: "active"
        },
        update: {
          policyPackId: pack.id,
          name: rule.name,
          status: "active"
        }
      });

      const existing = await tx.policyVersion.findUnique({
        where: {
          policyRecordId_version: {
            policyRecordId: policy.id,
            version
          }
        }
      });
      if (existing) {
        skipped.push({ policy_id: rule.policy_id, version, reason: "unchanged_hash" });
        continue;
      }

      await tx.policyVersion.create({
        data: {
          id: createId("polver"),
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          policyRecordId: policy.id,
          version,
          priority: rule.priority,
          decision: rule.decision,
          reason: rule.reason,
          definition: {
            when: rule.when,
            pack_id: input.packId,
            pack_scope: input.scope ?? "workspace",
            rollout_mode: input.rolloutMode ?? "enforce",
            imported_from: input.source ?? "api"
          } as Prisma.InputJsonValue,
          requiredChecks: (rule.required_checks ?? []) as Prisma.InputJsonValue,
          approvers: (rule.approvers ?? []) as Prisma.InputJsonValue,
          status: "active"
        }
      });
      imported.push({ policy_id: rule.policy_id, version, status: "active" });
    }

    await emitAuditEvent(tx, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      traceId: createId("trc"),
      eventType: "policy_pack.imported",
      actorType: "user",
      actorId: input.importedBy ?? "policy_admin",
      metadata: {
        policy_pack_id: pack.id,
        pack_id: input.packId,
        imported_count: imported.length,
        skipped_count: skipped.length,
        scope: input.scope ?? "workspace",
        rollout_mode: input.rolloutMode ?? "enforce"
      }
    });

    return { pack, imported, skipped };
  });

  return {
    status: 201 as const,
    body: {
      policy_pack: serializePolicyPack({ ...result.pack, policies: [] }),
      imported: result.imported,
      skipped: result.skipped
    }
  };
}

export async function exportPolicyPack(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    packId: string;
  }
) {
  const pack = await prisma.policyPack.findFirst({
    where: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      OR: [{ id: input.packId }, { packId: input.packId }]
    },
    include: {
      policies: {
        where: { status: "active" },
        include: {
          versions: {
            where: { status: "active" },
            orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
            take: 1
          }
        },
        orderBy: { policyId: "asc" }
      }
    }
  });

  if (!pack) return { status: 404 as const, body: { error: "Policy pack not found" } };

  return {
    status: 200 as const,
    body: {
      policy_pack: serializePolicyPack(pack),
      export: {
        pack_id: pack.packId,
        name: pack.name,
        scope: pack.scope,
        source: pack.source,
        config: pack.config,
        rules: pack.policies.flatMap((policy) => {
          const version = policy.versions[0];
          if (!version) return [];
          return [
            {
              policy_id: policy.policyId,
              name: policy.name,
              priority: version.priority,
              when: recordFrom(recordFrom(version.definition).when),
              decision: version.decision,
              reason: version.reason,
              required_checks: stringArray(version.requiredChecks),
              approvers: stringArray(version.approvers)
            }
          ];
        })
      }
    }
  };
}

function serializePolicyPack(pack: {
  id: string;
  tenantId: string;
  workspaceId: string;
  packId: string;
  name: string;
  scope: string;
  source: string;
  status: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
  policies?: Array<{ id: string; versions: unknown[] }>;
}) {
  return {
    id: pack.id,
    tenant_id: pack.tenantId,
    workspace_id: pack.workspaceId,
    pack_id: pack.packId,
    name: pack.name,
    scope: pack.scope,
    source: pack.source,
    status: pack.status,
    config: pack.config,
    policy_count: pack.policies?.length ?? 0,
    active_version_count: pack.policies?.reduce((sum, policy) => sum + policy.versions.length, 0) ?? 0,
    created_at: pack.createdAt.toISOString(),
    updated_at: pack.updatedAt.toISOString()
  };
}

function versionForPolicyRule(rule: DemoPolicyRule) {
  return `pack-${createHash("sha256").update(stableJson(rule)).digest("hex").slice(0, 12)}`;
}

export function serializePolicyWithVersion(
  policy: {
    id: string;
    tenantId: string;
    workspaceId: string;
    policyId: string;
    name: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  version: {
    id: string;
    version: string;
    priority: number;
    decision: DemoPolicyRule["decision"];
    reason: string;
    definition: unknown;
    requiredChecks: unknown;
    approvers: unknown;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  } | null
) {
  const definition = recordFrom(version?.definition);
  return {
    id: policy.id,
    tenant_id: policy.tenantId,
    workspace_id: policy.workspaceId,
    policy_id: policy.policyId,
    name: policy.name,
    status: policy.status,
    version: version?.version ?? "unknown",
    version_status: version?.status ?? "inactive",
    priority: version?.priority ?? 0,
    decision: version?.decision ?? "ALLOW",
    reason: version?.reason ?? "",
    definition: version?.definition ?? {},
    when: recordFrom(definition.when),
    required_checks: version?.requiredChecks ?? [],
    approvers: version?.approvers ?? [],
    created_at: policy.createdAt.toISOString(),
    updated_at: policy.updatedAt.toISOString(),
    version_created_at: version?.createdAt.toISOString() ?? null,
    version_updated_at: version?.updatedAt.toISOString() ?? null
  };
}

function policyRuleWarnings(rule: DemoPolicyRule) {
  const warnings: string[] = [];
  if (!Object.prototype.hasOwnProperty.call(rule.when, "skill")) {
    warnings.push("Policy has no when.skill condition and may apply broadly.");
  }
  if (rule.decision === "DENY" && (rule.required_checks ?? []).length > 0) {
    warnings.push("DENY policies preserve required_checks for audit/export, but runtime blocks before evidence collection.");
  }
  return warnings;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

function normalizeForStableJson(value: unknown): unknown {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalizeForStableJson(record[key])]));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
