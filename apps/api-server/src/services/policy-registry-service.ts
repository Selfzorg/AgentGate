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
