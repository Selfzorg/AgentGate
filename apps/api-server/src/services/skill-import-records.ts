import { normalizeEvidenceTaskSpecs, type SkillEvidenceTaskSpec, type SkillRegistryCandidate } from "@agentgate/skill-registry";
import { Prisma } from "@prisma/client";
import { createId } from "./id";
import {
  evidenceWarningsForChecks,
  inferPolicyAliasesForCandidate,
  inferredRequiredChecksForCandidate,
  normalizeRequiredChecks,
  rawRequiredEvidenceForCandidate
} from "./imported-skill-governance";

export function candidateCreateData(
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

export function serializeImportBatch(batch: {
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
    candidates: batch.candidates?.map((candidate) => {
      const governanceCandidate = candidateForGovernance(candidate);
      const inferredRequiredChecks = inferredRequiredChecksForCandidate(governanceCandidate);
      const rawRequiredEvidence = rawRequiredEvidenceForCandidate(candidate);

      return {
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
        evidence_tasks: normalizeEvidenceTaskSpecs(recordFrom(candidate.metadata).evidence_tasks).tasks,
        inferred_policy_aliases: inferPolicyAliasesForCandidate(governanceCandidate),
        inferred_required_checks: inferredRequiredChecks,
        required_evidence_raw: rawRequiredEvidence,
        evidence_warnings: evidenceWarningsForChecks(inferredRequiredChecks, rawRequiredEvidence),
        review_status: candidate.reviewStatus,
        imported_skill_record_id: candidate.importedSkillRecordId,
        imported_skill_version_id: candidate.importedSkillVersionId,
        review_notes: candidate.reviewNotes,
        created_at: candidate.createdAt.toISOString(),
        updated_at: candidate.updatedAt.toISOString()
      };
    })
  };
}

export function reviewMetadataForCandidate(
  candidate: {
    name: string;
    skillId: string;
    description: string | null;
    relativePath: string;
    declaredTools: unknown;
    skillType: string;
    sideEffectLevel: string;
    defaultRiskLevel: string;
    metadata: unknown;
  },
  review: {
    owners: string[];
    approverRoles: string[];
    requiredChecks?: string[] | undefined;
    policyAliases?: string[] | undefined;
    evidenceTasks?: SkillEvidenceTaskSpec[] | undefined;
  }
) {
  const metadata = recordFrom(candidate.metadata);
  const ownerDefaults = stringArray(metadata.owners);
  const approverDefaults = stringArray(metadata.approver_roles);
  const reviewedEvidenceTasks = review.evidenceTasks
    ? normalizeEvidenceTaskSpecs(review.evidenceTasks, { sourceLabel: "candidate_reviews.evidence_tasks" })
    : normalizeEvidenceTaskSpecs(metadata.evidence_tasks);
  const requiredChecks = normalizeRequiredChecks(
    reviewedEvidenceTasks.tasks.length > 0
      ? reviewedEvidenceTasks.tasks.map((task) => task.check_key)
      : review.requiredChecks && review.requiredChecks.length > 0
        ? review.requiredChecks
        : inferredRequiredChecksForCandidate(candidateForGovernance(candidate))
  );
  const rawRequiredEvidence = rawRequiredEvidenceForCandidate(candidate);

  return {
    owners: review.owners.length > 0 ? review.owners : ownerDefaults,
    approverRoles: review.approverRoles.length > 0 ? review.approverRoles : approverDefaults,
    requiredChecks,
    policyAliases:
      review.policyAliases && review.policyAliases.length > 0
        ? normalizePolicyAliases(review.policyAliases)
        : inferPolicyAliasesForCandidate(candidateForGovernance(candidate)),
    evidenceTasks: reviewedEvidenceTasks.tasks,
    evidenceWarnings: [...reviewedEvidenceTasks.warnings, ...evidenceWarningsForChecks(requiredChecks, rawRequiredEvidence)]
  };
}

export function canImportActive(
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

export function skillVersionConfig(
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
    requiredChecks: string[];
    policyAliases: string[];
    evidenceTasks: SkillEvidenceTaskSpec[];
    evidenceWarnings: string[];
    activeByReview: { active: boolean; reason: string };
  }
) {
  const metadata = recordFrom(candidate.metadata);
  const rawRequiredEvidence = rawRequiredEvidenceForCandidate(candidate);
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
    environments: stringArray(metadata.environments),
    supports_dry_run: booleanFrom(metadata.supports_dry_run),
    dry_run: recordFrom(metadata.dry_run),
    required_evidence: rawRequiredEvidence,
    required_checks: input.requiredChecks,
    evidence_tasks: input.evidenceTasks,
    policy_aliases: input.policyAliases,
    evidence_review: {
      reviewed_required_checks: input.requiredChecks,
      inferred_required_checks: inferredRequiredChecksForCandidate(candidateForGovernance(candidate)),
      evidence_tasks: input.evidenceTasks,
      required_evidence_raw: rawRequiredEvidence,
      warnings: input.evidenceWarnings
    },
    classification_flags: recordFrom(metadata.classification_flags),
    supporting_files: stringArray(metadata.supporting_files),
    supporting_file_count: numberFrom(metadata.supporting_file_count),
    supporting_file_bytes: numberFrom(metadata.supporting_file_bytes),
    dynamic_shell_blocks: Array.isArray(metadata.dynamic_shell_blocks) ? metadata.dynamic_shell_blocks : [],
    execution_snapshot: recordFrom(metadata.execution_snapshot),
    tags: tagsForCandidate(candidate),
    import_batch_id: input.batchId,
    import_candidate_id: candidate.candidateId,
    import_warnings: candidate.warnings,
    active_review: input.activeByReview,
    metadata: candidate.metadata
  };
}

export function skillVersionExecution(candidate: {
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

export function categoryForCandidate(candidate: { skillType: string; sideEffectLevel: string; name: string; skillId: string; metadata: unknown }) {
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

export function versionForHash(contentHash: string) {
  return `import-${contentHash.replace(/^sha256:/, "").slice(0, 12)}`;
}

function tagsForCandidate(candidate: { sourceType: string; skillType: string; sideEffectLevel: string }) {
  return [candidate.sourceType, candidate.skillType, candidate.sideEffectLevel];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanFrom(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function candidateForGovernance(candidate: {
  name?: string;
  skillId?: string;
  description?: string | null;
  relativePath?: string;
  declaredTools?: unknown;
  skillType?: string;
  sideEffectLevel?: string;
  defaultRiskLevel?: string;
  metadata: unknown;
}) {
  return {
    name: candidate.name ?? "",
    skillId: candidate.skillId ?? "",
    description: candidate.description ?? null,
    relativePath: candidate.relativePath ?? "",
    declaredTools: candidate.declaredTools ?? [],
    skillType: candidate.skillType ?? "execution",
    sideEffectLevel: candidate.sideEffectLevel ?? "mutating",
    defaultRiskLevel: candidate.defaultRiskLevel ?? "medium",
    metadata: candidate.metadata
  };
}

function normalizePolicyAliases(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
