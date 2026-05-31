const evidenceAliases: Record<string, string> = {
  "automated-testing-report": "tests_passed",
  "automated-testing": "tests_passed",
  "test-report": "tests_passed",
  "tests": "tests_passed",
  "ci": "ci_passed",
  "ci-status": "ci_passed",
  "rollback-plan": "rollback_plan_exists",
  "rollback": "rollback_plan_exists",
  "staging-deploy": "staging_deploy_successful",
  "staging-deployment": "staging_deploy_successful",
  "security-scan": "security_scan_passed",
  "security_scan": "security_scan_passed",
  "security": "security_scan_passed"
};

export const knownEvidenceChecks = new Set([
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

export type ImportedSkillGovernanceCandidate = {
  name: string;
  skillId: string;
  description: string | null;
  relativePath: string;
  declaredTools: unknown;
  skillType: string;
  sideEffectLevel: string;
  defaultRiskLevel: string;
  metadata: unknown;
};

export function inferPolicyAliasesForCandidate(candidate: ImportedSkillGovernanceCandidate): string[] {
  const text = candidateGovernanceText(candidate);
  const category = categoryFromCandidate(candidate);
  const aliases: string[] = [];

  const looksLikeDeployment = category === "deployment" || /\b(deploy|deployment|release|vercel|kubernetes|k8s)\b/.test(text);
  if (looksLikeDeployment && /vercel\s+deploy|deploy/.test(text)) {
    if (/\b(prod|production)\b/.test(text)) aliases.push("deploy-production");
    if (/\b(staging|stage)\b/.test(text)) aliases.push("deploy-staging");
  }

  if (looksLikeDropTable(text)) {
    aliases.push("drop-table");
  } else if (category === "database" && /\b(migration|migrate|prisma|schema|apply[-_\s]?migration)\b/.test(text)) {
    aliases.push("run-db-migration");
  }

  return uniqueStrings(aliases);
}

export function rawRequiredEvidenceForCandidate(candidate: Pick<ImportedSkillGovernanceCandidate, "metadata">): string[] {
  return stringArray(recordFrom(candidate.metadata).required_evidence);
}

export function inferredRequiredChecksForCandidate(candidate: ImportedSkillGovernanceCandidate): string[] {
  return normalizeRequiredChecks(rawRequiredEvidenceForCandidate(candidate));
}

export function normalizeRequiredChecks(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return uniqueStrings(values.flatMap((value) => {
    const normalized = normalizeEvidenceCheckKey(value);
    return normalized ? [normalized] : [];
  }));
}

export function normalizeEvidenceCheckKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const aliased = evidenceAliases[slug] ?? slug.replaceAll("-", "_");
  return aliased.trim().length > 0 ? aliased : null;
}

export function evidenceWarningsForChecks(checks: string[], rawEvidence: string[] = []): string[] {
  const warnings = checks
    .filter((check) => !knownEvidenceChecks.has(check))
    .map((check) => `Evidence check ${check} requires a custom evidence worker or will remain missing.`);
  const normalized = new Set(checks);
  for (const raw of rawEvidence) {
    const check = normalizeEvidenceCheckKey(raw);
    if (check && !normalized.has(check)) {
      warnings.push(`Evidence entry ${raw} could not be mapped into required checks.`);
    }
  }
  return uniqueStrings(warnings);
}

export function mergeRequiredChecks(...groups: Array<unknown>): string[] {
  return uniqueStrings(groups.flatMap((group) => normalizeRequiredChecks(Array.isArray(group) ? group : [])));
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

export function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function candidateGovernanceText(candidate: ImportedSkillGovernanceCandidate) {
  return [
    candidate.name,
    candidate.skillId,
    candidate.description ?? "",
    candidate.relativePath,
    stringArray(candidate.declaredTools).join(" "),
    JSON.stringify(recordFrom(candidate.metadata).classification_flags ?? {})
  ]
    .join(" ")
    .toLowerCase();
}

function categoryFromCandidate(candidate: ImportedSkillGovernanceCandidate) {
  const frontmatter = recordFrom(recordFrom(candidate.metadata).frontmatter);
  const declaredCategory = stringFrom(frontmatter.category);
  if (declaredCategory) return declaredCategory.toLowerCase();

  const text = `${candidate.name} ${candidate.skillId} ${candidate.relativePath}`.toLowerCase();
  if (candidate.skillType === "evidence") return "evidence";
  if (/deploy|release|vercel|kubernetes|k8s/.test(text)) return "deployment";
  if (/migrat|database|postgres|drop|table|schema/.test(text)) return "database";
  if (/merge|pull|pr|git|github/.test(text)) return "source_control";
  if (candidate.sideEffectLevel === "read_only") return "read_only";
  return "imported";
}

function looksLikeDropTable(text: string) {
  return (
    /\bdrop[-_\s]?table\b/.test(text) ||
    /\btruncate[-_\s]?table\b/.test(text) ||
    (/\b(drop|truncate)\b/.test(text) && /\b(table|database table)\b/.test(text))
  );
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
