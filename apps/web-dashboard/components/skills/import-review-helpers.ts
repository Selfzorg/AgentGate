import type { SkillImportCandidate, SkillRecord } from "@/lib/api-client";

export type CandidateReviewDraft = {
  requiredChecks: string;
  policyAliases: string;
};

const evidenceAliases: Record<string, string> = {
  "automated-testing-report": "tests_passed",
  "automated-testing": "tests_passed",
  "test-report": "tests_passed",
  tests: "tests_passed",
  ci: "ci_passed",
  "ci-status": "ci_passed",
  "rollback-plan": "rollback_plan_exists",
  rollback: "rollback_plan_exists",
  "staging-deploy": "staging_deploy_successful",
  "staging-deployment": "staging_deploy_successful",
  "security-scan": "security_scan_passed",
  security_scan: "security_scan_passed",
  security: "security_scan_passed"
};

const knownEvidenceChecks = new Set([
  "ci_passed",
  "tests_passed",
  "rollback_plan_exists",
  "staging_deploy_successful",
  "required_reviews_passed",
  "branch_protection_satisfied",
  "dry_run_completed",
  "schema_diff_generated",
  "backup_exists",
  "security_scan_passed"
]);

export function reviewDraftsForCandidates(candidates: SkillImportCandidate[]) {
  return Object.fromEntries(candidates.map((candidate) => [candidate.candidate_id, defaultReviewDraft(candidate)]));
}

export function defaultReviewDraft(candidate: SkillImportCandidate): CandidateReviewDraft {
  return {
    requiredChecks: (candidate.inferred_required_checks ?? inferredRequiredChecksForCandidate(candidate)).join(", "),
    policyAliases: (candidate.inferred_policy_aliases ?? inferPolicyAliasesForCandidate(candidate)).join(", ")
  };
}

export function rawRequiredEvidenceForCandidate(candidate: { metadata: Record<string, unknown>; required_evidence_raw?: string[] }) {
  if (candidate.required_evidence_raw) return candidate.required_evidence_raw;
  return stringArray(candidate.metadata.required_evidence);
}

export function inferredRequiredChecksForCandidate(candidate: { metadata: Record<string, unknown>; required_evidence_raw?: string[] }) {
  return uniqueStrings(rawRequiredEvidenceForCandidate(candidate).flatMap((entry) => {
    const check = normalizeEvidenceCheckKey(entry);
    return check ? [check] : [];
  }));
}

export function inferPolicyAliasesForCandidate(candidate: {
  name: string;
  skill_id?: string;
  skillId?: string;
  description: string | null;
  relative_path?: string;
  relativePath?: string;
  declared_tools?: string[];
  declaredTools?: string[];
  skill_type?: string;
  skillType?: string;
  side_effect_level?: string;
  sideEffectLevel?: string;
  metadata: Record<string, unknown>;
}) {
  const relativePath = candidate.relative_path ?? candidate.relativePath ?? "";
  const declaredTools = candidate.declared_tools ?? candidate.declaredTools ?? [];
  const skillType = candidate.skill_type ?? candidate.skillType ?? "execution";
  const sideEffectLevel = candidate.side_effect_level ?? candidate.sideEffectLevel ?? "mutating";
  const skillId = candidate.skill_id ?? candidate.skillId ?? "";
  const category = categoryForCandidate({
    name: candidate.name,
    skillId,
    relativePath,
    skillType,
    sideEffectLevel,
    metadata: candidate.metadata
  });
  const text = [candidate.name, skillId, candidate.description ?? "", relativePath, declaredTools.join(" ")].join(" ").toLowerCase();
  const aliases: string[] = [];

  const looksLikeDeployment = category === "deployment" || /\b(deploy|deployment|release|vercel|kubernetes|k8s)\b/.test(text);
  if (looksLikeDeployment && /vercel\s+deploy|deploy/.test(text)) {
    if (/\b(prod|production)\b/.test(text)) aliases.push("deploy-production");
    if (/\b(staging|stage)\b/.test(text)) aliases.push("deploy-staging");
  }
  if (category === "database" || /\b(migration|migrate|prisma|database|schema)\b/.test(text)) aliases.push("run-db-migration");
  return uniqueStrings(aliases);
}

export function evidenceWarningsForChecks(checks: string[], rawEvidence: string[]) {
  return uniqueStrings(
    checks
      .filter((check) => !knownEvidenceChecks.has(check))
      .map((check) => `Evidence check ${check} requires a custom evidence worker or will remain missing.`)
      .concat(
        rawEvidence.flatMap((entry) => {
          const check = normalizeEvidenceCheckKey(entry);
          return check && checks.includes(check) ? [] : [`Evidence entry ${entry} could not be mapped into required checks.`];
        })
      )
  );
}

export function warningCountForCandidate(candidate: SkillImportCandidate) {
  return candidate.warnings.length + (candidate.evidence_warnings?.length ?? 0);
}

export function sourceTypeFromSkill(skill: SkillRecord) {
  const source = skill.config.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const type = (source as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeEvidenceCheckKey(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return null;
  return evidenceAliases[slug] ?? slug.replaceAll("-", "_");
}

function categoryForCandidate(candidate: {
  name: string;
  skillId: string;
  relativePath: string;
  skillType: string;
  sideEffectLevel: string;
  metadata: Record<string, unknown>;
}) {
  const frontmatter = recordFrom(candidate.metadata.frontmatter);
  if (typeof frontmatter.category === "string" && frontmatter.category.trim()) return frontmatter.category.toLowerCase();
  const text = `${candidate.name} ${candidate.skillId} ${candidate.relativePath}`.toLowerCase();
  if (candidate.skillType === "evidence") return "evidence";
  if (/deploy|release|vercel|kubernetes|k8s/.test(text)) return "deployment";
  if (/migrat|database|postgres|drop|table|schema/.test(text)) return "database";
  if (candidate.sideEffectLevel === "read_only") return "read_only";
  return "imported";
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
