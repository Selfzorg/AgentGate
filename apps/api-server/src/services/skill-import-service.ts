import { scanAgentSkills, type ScanAgentSkillsResult } from "@agentgate/skill-registry";
import { Prisma, type PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";
import { createId } from "./id";
import {
  candidateCreateData,
  canImportActive,
  categoryForCandidate,
  reviewMetadataForCandidate,
  serializeImportBatch,
  skillVersionConfig,
  skillVersionExecution,
  versionForHash
} from "./skill-import-records";

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
  candidateReviews?: Array<{
    candidateId: string;
    requiredChecks?: string[] | undefined;
    policyAliases?: string[] | undefined;
  }> | undefined;
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
    const candidateReviews = new Map((input.candidateReviews ?? []).map((review) => [review.candidateId, review]));

    for (const candidate of batch.candidates) {
      const version = versionForHash(candidate.contentHash);
      const candidateReview = candidateReviews.get(candidate.candidateId);
      const reviewMetadata = reviewMetadataForCandidate(candidate, {
        owners: input.owners ?? [],
        approverRoles: input.approverRoles ?? [],
        requiredChecks: candidateReview?.requiredChecks,
        policyAliases: candidateReview?.policyAliases
      });
      const activeByReview = canImportActive(candidate, {
        owners: reviewMetadata.owners,
        approverRoles: reviewMetadata.approverRoles
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
            owners: reviewMetadata.owners,
            approverRoles: reviewMetadata.approverRoles,
            requiredChecks: reviewMetadata.requiredChecks,
            policyAliases: reviewMetadata.policyAliases,
            evidenceWarnings: reviewMetadata.evidenceWarnings,
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
            active_review_reason: activeByReview.reason,
            required_checks: reviewMetadata.requiredChecks,
            policy_aliases: reviewMetadata.policyAliases,
            evidence_warnings: reviewMetadata.evidenceWarnings
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
