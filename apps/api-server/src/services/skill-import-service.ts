import { scanAgentSkills, type ScanAgentSkillsResult, type SkillRegistryCandidate } from "@agentgate/skill-registry";
import { Prisma, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createId } from "./id";

export type RegistryScanInput = {
  tenantId: string;
  workspaceId: string;
  rootDir: string;
  includeUserScopes?: boolean | undefined;
  persistSnapshot?: boolean | undefined;
  requestedBy?: string | undefined;
};

export type RegistryImportInput = Omit<RegistryScanInput, "persistSnapshot">;

export type ApproveImportInput = {
  batchId: string;
  candidateIds?: string[] | undefined;
  reviewedBy?: string | undefined;
  comment?: string | undefined;
  owners?: string[] | undefined;
  approverRoles?: string[] | undefined;
};

export type RejectImportInput = {
  batchId: string;
  reviewedBy?: string | undefined;
  comment?: string | undefined;
};

export async function scanRegistryForImport(prisma: PrismaClient, input: RegistryScanInput) {
  const scan = await scanAgentSkills({
    rootDir: input.rootDir,
    includeUserScopes: input.includeUserScopes
  });

  if (!input.persistSnapshot) {
    return {
      scan,
      import_batch: null
    };
  }

  const batch = await persistImportBatch(prisma, {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    rootDir: scan.rootDir,
    includeUserScopes: input.includeUserScopes,
    requestedBy: input.requestedBy,
    scan
  });

  return {
    scan,
    import_batch: serializeImportBatch(batch)
  };
}

export async function createRegistryImport(prisma: PrismaClient, input: RegistryImportInput) {
  const scan = await scanAgentSkills({
    rootDir: input.rootDir,
    includeUserScopes: input.includeUserScopes
  });
  const batch = await persistImportBatch(prisma, {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    rootDir: scan.rootDir,
    includeUserScopes: input.includeUserScopes,
    requestedBy: input.requestedBy,
    scan
  });

  return {
    status: 201 as const,
    body: {
      import_batch: serializeImportBatch(batch),
      scan
    }
  };
}

export async function getRegistryImportBatch(prisma: PrismaClient, batchId: string) {
  const batch = await prisma.skillImportBatch.findUnique({
    where: { id: batchId },
    include: {
      candidates: {
        orderBy: [{ sourceType: "asc" }, { defaultRiskLevel: "desc" }, { name: "asc" }]
      }
    }
  });

  if (!batch) {
    return { status: 404 as const, body: { error: "Skill import batch not found" } };
  }

  return {
    status: 200 as const,
    body: {
      import_batch: serializeImportBatch(batch)
    }
  };
}

export async function approveRegistryImportBatch(prisma: PrismaClient, input: ApproveImportInput) {
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.skillImportBatch.findUnique({
      where: { id: input.batchId },
      include: {
        candidates: {
          where: {
            reviewStatus: "pending",
            ...(input.candidateIds && input.candidateIds.length > 0 ? { candidateId: { in: input.candidateIds } } : {})
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!batch) return { status: 404 as const, body: { error: "Skill import batch not found" } };
    if (batch.status === "rejected") return { status: 409 as const, body: { error: "Skill import batch is rejected" } };
    if (input.candidateIds && input.candidateIds.length > 0 && batch.candidates.length !== input.candidateIds.length) {
      return {
        status: 404 as const,
        body: {
          error: "One or more import candidates were not found or already reviewed"
        }
      };
    }

    const imported: Array<{ candidate_id: string; skill_id: string; version: string; status: string }> = [];
    const skipped: Array<{ candidate_id: string; skill_id: string; version: string; reason: string }> = [];
    const disabled: Array<{ candidate_id: string; skill_id: string; version: string; reason: string }> = [];

    for (const candidate of batch.candidates) {
      const version = versionForHash(candidate.contentHash);
      const activeByReview = canImportActive(candidate, {
        owners: input.owners ?? [],
        approverRoles: input.approverRoles ?? []
      });
      const versionStatus = activeByReview.active ? "active" : "inactive";
      const skillUpdate: Prisma.SkillUpdateInput = {
        name: candidate.name,
        category: categoryForCandidate(candidate),
        description: candidate.description,
        defaultRiskLevel: candidate.defaultRiskLevel
      };
      if (versionStatus === "active") skillUpdate.status = "active";
      const skill = await tx.skill.upsert({
        where: {
          tenantId_workspaceId_skillId: {
            tenantId: candidate.tenantId,
            workspaceId: candidate.workspaceId,
            skillId: candidate.skillId
          }
        },
        create: {
          id: createId("skill"),
          tenantId: candidate.tenantId,
          workspaceId: candidate.workspaceId,
          skillId: candidate.skillId,
          name: candidate.name,
          category: categoryForCandidate(candidate),
          description: candidate.description,
          defaultRiskLevel: candidate.defaultRiskLevel,
          status: versionStatus
        },
        update: {
          ...skillUpdate
        }
      });

      const existingVersion = await tx.skillVersion.findUnique({
        where: {
          skillRecordId_version: {
            skillRecordId: skill.id,
            version
          }
        }
      });

      if (existingVersion) {
        await tx.skillImportCandidate.update({
          where: { id: candidate.id },
          data: {
            reviewStatus: "skipped",
            importedSkillRecordId: skill.id,
            importedSkillVersionId: existingVersion.id,
            reviewNotes: {
              reason: "unchanged_hash",
              reviewed_by: input.reviewedBy ?? "user_service_owner"
            } as Prisma.InputJsonValue
          }
        });
        skipped.push({
          candidate_id: candidate.candidateId,
          skill_id: candidate.skillId,
          version,
          reason: "unchanged hash already imported"
        });
        continue;
      }

      const skillVersion = await tx.skillVersion.create({
        data: {
          id: createId("skillver"),
          tenantId: candidate.tenantId,
          workspaceId: candidate.workspaceId,
          skillRecordId: skill.id,
          version,
          status: versionStatus,
          config: skillVersionConfig(candidate, {
            batchId: batch.id,
            owners: input.owners ?? [],
            approverRoles: input.approverRoles ?? [],
            activeByReview
          }) as Prisma.InputJsonValue,
          execution: skillVersionExecution(candidate) as Prisma.InputJsonValue
        }
      });

      await tx.skillImportCandidate.update({
        where: { id: candidate.id },
        data: {
          reviewStatus: "imported",
          importedSkillRecordId: skill.id,
          importedSkillVersionId: skillVersion.id,
          reviewNotes: {
            reviewed_by: input.reviewedBy ?? "user_service_owner",
            comment: input.comment ?? null,
            version_status: versionStatus,
            active_review_reason: activeByReview.reason
          } as Prisma.InputJsonValue
        }
      });

      const importedRow = {
        candidate_id: candidate.candidateId,
        skill_id: candidate.skillId,
        version,
        status: versionStatus
      };
      imported.push(importedRow);
      if (versionStatus !== "active") {
        disabled.push({
          ...importedRow,
          reason: activeByReview.reason
        });
      }
    }

    const updatedBatch = await tx.skillImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "approved",
        reviewedBy: input.reviewedBy ?? "user_service_owner",
        reviewComment: input.comment ?? null,
        reviewedAt: new Date()
      },
      include: {
        candidates: {
          orderBy: [{ sourceType: "asc" }, { defaultRiskLevel: "desc" }, { name: "asc" }]
        }
      }
    });

    await emitAuditEvent(tx, {
      tenantId: batch.tenantId,
      workspaceId: batch.workspaceId,
      traceId: createId("trc"),
      eventType: "skill_import.approved",
      actorType: "user",
      actorId: input.reviewedBy ?? "user_service_owner",
      metadata: {
        batch_id: batch.id,
        imported_count: imported.length,
        skipped_count: skipped.length,
        disabled_count: disabled.length,
        imported,
        skipped,
        disabled
      }
    });

    return {
      status: 200 as const,
      body: {
        import_batch: serializeImportBatch(updatedBatch),
        imported,
        skipped,
        disabled
      }
    };
  });

  return result;
}

export async function rejectRegistryImportBatch(prisma: PrismaClient, input: RejectImportInput) {
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.skillImportBatch.findUnique({
      where: { id: input.batchId },
      include: {
        candidates: true
      }
    });

    if (!batch) return { status: 404 as const, body: { error: "Skill import batch not found" } };
    if (batch.status !== "pending") return { status: 409 as const, body: { error: "Skill import batch is not pending" } };

    await tx.skillImportCandidate.updateMany({
      where: { batchId: batch.id, reviewStatus: "pending" },
      data: {
        reviewStatus: "rejected",
        reviewNotes: {
          reviewed_by: input.reviewedBy ?? "user_service_owner",
          comment: input.comment ?? null
        } as Prisma.InputJsonValue
      }
    });

    const updatedBatch = await tx.skillImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "rejected",
        reviewedBy: input.reviewedBy ?? "user_service_owner",
        reviewComment: input.comment ?? null,
        reviewedAt: new Date()
      },
      include: {
        candidates: {
          orderBy: [{ sourceType: "asc" }, { defaultRiskLevel: "desc" }, { name: "asc" }]
        }
      }
    });

    await emitAuditEvent(tx, {
      tenantId: batch.tenantId,
      workspaceId: batch.workspaceId,
      traceId: createId("trc"),
      eventType: "skill_import.rejected",
      actorType: "user",
      actorId: input.reviewedBy ?? "user_service_owner",
      metadata: {
        batch_id: batch.id,
        candidate_count: batch.candidates.length,
        comment: input.comment ?? null
      }
    });

    return {
      status: 200 as const,
      body: {
        import_batch: serializeImportBatch(updatedBatch)
      }
    };
  });

  return result;
}

async function persistImportBatch(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    rootDir: string;
    includeUserScopes?: boolean | undefined;
    requestedBy?: string | undefined;
    scan: ScanAgentSkillsResult;
  }
) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.skillImportBatch.create({
      data: {
        id: createId("skb"),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        rootDir: input.rootDir,
        candidateCount: input.scan.candidates.length,
        warningCount: input.scan.summary.warningCount,
        scanConfig: {
          include_user_scopes: input.includeUserScopes ?? false,
          scanned_at: input.scan.scannedAt,
          duplicate_groups: input.scan.duplicateGroups,
          summary: input.scan.summary
        } as Prisma.InputJsonValue,
        warnings: input.scan.warnings as Prisma.InputJsonValue,
        requestedBy: input.requestedBy ?? "user_service_owner",
        candidates: {
          create: input.scan.candidates.map((candidate) => candidateCreateData(input, candidate))
        }
      },
      include: {
        candidates: {
          orderBy: [{ sourceType: "asc" }, { defaultRiskLevel: "desc" }, { name: "asc" }]
        }
      }
    });

    await emitAuditEvent(tx, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      traceId: createId("trc"),
      eventType: "skill_import.scanned",
      actorType: "user",
      actorId: input.requestedBy ?? "user_service_owner",
      metadata: {
        batch_id: batch.id,
        root_dir: input.rootDir,
        candidate_count: input.scan.candidates.length,
        warning_count: input.scan.summary.warningCount,
        duplicate_groups: input.scan.duplicateGroups
      }
    });

    return batch;
  });
}

function candidateCreateData(
  input: {
    tenantId: string;
    workspaceId: string;
  },
  candidate: SkillRegistryCandidate
): Prisma.SkillImportCandidateCreateWithoutBatchInput {
  return {
    id: createId("skc"),
    tenant: { connect: { id: input.tenantId } },
    workspace: { connect: { id: input.workspaceId } },
    candidateId: candidate.id,
    skillId: candidate.skillId,
    name: candidate.name,
    description: candidate.description,
    sourceType: candidate.sourceType,
    sourcePath: candidate.sourcePath,
    relativePath: candidate.relativePath,
    scope: candidate.scope,
    contentHash: candidate.contentHash,
    declaredTools: candidate.declaredTools as Prisma.InputJsonValue,
    skillType: candidate.skillType,
    sideEffectLevel: candidate.sideEffectLevel,
    defaultRiskLevel: candidate.defaultRiskLevel,
    allowedRuntimes: candidate.allowedRuntimes as Prisma.InputJsonValue,
    preferredRuntimes: candidate.preferredRuntimes as Prisma.InputJsonValue,
    warnings: candidate.warnings as Prisma.InputJsonValue,
    metadata: candidate.metadata as Prisma.InputJsonValue
  };
}

function serializeImportBatch(batch: {
  id: string;
  tenantId: string;
  workspaceId: string;
  rootDir: string;
  status: string;
  candidateCount: number;
  warningCount: number;
  scanConfig: unknown;
  warnings: unknown;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewComment: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  candidates?: Array<{
    id: string;
    candidateId: string;
    skillId: string;
    name: string;
    description: string | null;
    sourceType: string;
    sourcePath: string;
    relativePath: string;
    scope: string;
    contentHash: string;
    declaredTools: unknown;
    skillType: string;
    sideEffectLevel: string;
    defaultRiskLevel: string;
    allowedRuntimes: unknown;
    preferredRuntimes: unknown;
    warnings: unknown;
    metadata: unknown;
    reviewStatus: string;
    importedSkillRecordId: string | null;
    importedSkillVersionId: string | null;
    reviewNotes: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: batch.id,
    tenant_id: batch.tenantId,
    workspace_id: batch.workspaceId,
    root_dir: batch.rootDir,
    status: batch.status,
    candidate_count: batch.candidateCount,
    warning_count: batch.warningCount,
    scan_config: batch.scanConfig,
    warnings: batch.warnings,
    requested_by: batch.requestedBy,
    reviewed_by: batch.reviewedBy,
    review_comment: batch.reviewComment,
    reviewed_at: batch.reviewedAt?.toISOString() ?? null,
    created_at: batch.createdAt.toISOString(),
    updated_at: batch.updatedAt.toISOString(),
    candidates: batch.candidates?.map((candidate) => ({
      id: candidate.id,
      candidate_id: candidate.candidateId,
      skill_id: candidate.skillId,
      name: candidate.name,
      description: candidate.description,
      source_type: candidate.sourceType,
      source_path: candidate.sourcePath,
      relative_path: candidate.relativePath,
      scope: candidate.scope,
      content_hash: candidate.contentHash,
      declared_tools: candidate.declaredTools,
      skill_type: candidate.skillType,
      side_effect_level: candidate.sideEffectLevel,
      default_risk_level: candidate.defaultRiskLevel,
      allowed_runtimes: candidate.allowedRuntimes,
      preferred_runtimes: candidate.preferredRuntimes,
      warnings: candidate.warnings,
      metadata: candidate.metadata,
      review_status: candidate.reviewStatus,
      imported_skill_record_id: candidate.importedSkillRecordId,
      imported_skill_version_id: candidate.importedSkillVersionId,
      review_notes: candidate.reviewNotes,
      created_at: candidate.createdAt.toISOString(),
      updated_at: candidate.updatedAt.toISOString()
    }))
  };
}

function canImportActive(
  candidate: {
    defaultRiskLevel: string;
    sideEffectLevel: string;
    warnings: unknown;
  },
  review: { owners: string[]; approverRoles: string[] }
) {
  const warnings = stringArray(candidate.warnings);
  const needsExplicitReview =
    candidate.sideEffectLevel === "mutating" ||
    candidate.defaultRiskLevel === "high" ||
    candidate.defaultRiskLevel === "critical" ||
    warnings.some((warning) => /missing description|invalid yaml|no declared tool/i.test(warning));

  if (!needsExplicitReview) return { active: true, reason: "low_risk_or_read_only" };
  if (review.owners.length > 0 && review.approverRoles.length > 0) return { active: true, reason: "explicit_owner_and_approver_review" };
  return { active: false, reason: "requires_owner_and_approver_review" };
}

function skillVersionConfig(
  candidate: {
    id: string;
    candidateId: string;
    sourceType: string;
    relativePath: string;
    scope: string;
    contentHash: string;
    skillType: string;
    sideEffectLevel: string;
    declaredTools: unknown;
    allowedRuntimes: unknown;
    preferredRuntimes: unknown;
    warnings: unknown;
    metadata: unknown;
  },
  input: {
    batchId: string;
    owners: string[];
    approverRoles: string[];
    activeByReview: { active: boolean; reason: string };
  }
) {
  return {
    source: {
      type: candidate.sourceType,
      path: candidate.relativePath,
      scope: candidate.scope,
      content_hash: candidate.contentHash,
      discovered_at: new Date().toISOString()
    },
    skill_type: candidate.skillType,
    side_effect_level: candidate.sideEffectLevel,
    declared_tools: candidate.declaredTools,
    allowed_runtimes: candidate.allowedRuntimes,
    preferred_runtimes: candidate.preferredRuntimes,
    input_schema: {},
    output_schema: {},
    owners: input.owners,
    approver_roles: input.approverRoles,
    tags: tagsForCandidate(candidate),
    import_batch_id: input.batchId,
    import_candidate_id: candidate.candidateId,
    import_warnings: candidate.warnings,
    active_review: input.activeByReview,
    metadata: candidate.metadata
  };
}

function skillVersionExecution(candidate: {
  sourceType: string;
  skillType: string;
  sideEffectLevel: string;
  allowedRuntimes: unknown;
  preferredRuntimes: unknown;
}) {
  const preferredRuntime = stringArray(candidate.preferredRuntimes)[0] ?? "local_deterministic";
  return {
    live_requires_execution_token: candidate.sideEffectLevel === "mutating",
    execution_mode: candidate.skillType === "evidence" ? "evidence_runtime" : "agent_runtime",
    entrypoint: {
      runtime: preferredRuntime,
      prompt_template: candidate.sourceType === "mcp_tool" ? "approved-mcp-tool-execution" : "approved-skill-execution"
    },
    idempotency_key_fields: ["skill_id", "content_hash", "environment"]
  };
}

function categoryForCandidate(candidate: { skillType: string; sideEffectLevel: string; name: string; skillId: string; metadata: unknown }) {
  const metadata = recordFrom(candidate.metadata);
  const frontmatter = recordFrom(metadata.frontmatter);
  const declaredCategory = stringFrom(frontmatter.category);
  if (declaredCategory) return declaredCategory;

  const text = `${candidate.name} ${candidate.skillId}`.toLowerCase();
  if (candidate.skillType === "evidence") return "evidence";
  if (/deploy|release|vercel|kubernetes|k8s/.test(text)) return "deployment";
  if (/migrat|database|postgres|drop|table|schema/.test(text)) return "database";
  if (/merge|pull|pr|git|github/.test(text)) return "source_control";
  if (candidate.sideEffectLevel === "read_only") return "read_only";
  return "imported";
}

function tagsForCandidate(candidate: { sourceType: string; skillType: string; sideEffectLevel: string }) {
  return [candidate.sourceType, candidate.skillType, candidate.sideEffectLevel];
}

function versionForHash(contentHash: string) {
  return `import-${contentHash.replace(/^sha256:/, "").slice(0, 12)}`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
