import type { EvidenceTaskSpec, SkillImportCandidate, SkillRecord } from "@/lib/api-client";

export type CandidateReviewDraft = {
  requiredChecks: string;
  policyAliases: string;
  evidenceTasks: EvidenceTaskSpec[];
};

export type EvidenceCheckOption = {
  key: string;
  label: string;
  description: string;
  source: "registered" | "built_in" | "custom";
};

export type EvidenceSkillOption = {
  skill_id: string;
  name: string;
  check_key: string;
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

export const builtInEvidenceCheckOptions: EvidenceCheckOption[] = [
  {
    key: "ci_passed",
    label: "CI Passed",
    description: "Verifies the latest CI status for the target repo/commit."
  },
  {
    key: "tests_passed",
    label: "Tests Passed",
    description: "Verifies test evidence for the proposed change."
  },
  {
    key: "rollback_plan_exists",
    label: "Rollback Plan",
    description: "Confirms a rollback plan is present before risky changes."
  },
  {
    key: "staging_deploy_successful",
    label: "Staging Deploy",
    description: "Confirms the change succeeded in staging first."
  },
  {
    key: "required_reviews_passed",
    label: "Required Reviews",
    description: "Checks required code or owner reviews."
  },
  {
    key: "branch_protection_satisfied",
    label: "Branch Protection",
    description: "Checks branch protection and merge rules."
  },
  {
    key: "dry_run_completed",
    label: "Dry Run",
    description: "Confirms a dry-run completed before mutation."
  },
  {
    key: "schema_diff_generated",
    label: "Schema Diff",
    description: "Confirms a schema diff was generated for DB changes."
  },
  {
    key: "backup_exists",
    label: "Backup Exists",
    description: "Confirms a backup artifact exists before destructive actions."
  },
  {
    key: "security_scan_passed",
    label: "Security Scan",
    description: "Verifies security scan evidence for the action."
  }
].map((option) => ({ ...option, source: "built_in" }));

export const knownEvidenceChecks = new Set(builtInEvidenceCheckOptions.map((option) => option.key));

export function reviewDraftsForCandidates(candidates: SkillImportCandidate[]) {
  return Object.fromEntries(candidates.map((candidate) => [candidate.candidate_id, defaultReviewDraft(candidate)]));
}

export function defaultReviewDraft(candidate: SkillImportCandidate): CandidateReviewDraft {
  const evidenceTasks = evidenceTasksForCandidate(candidate);
  return {
    requiredChecks: (evidenceTasks.length > 0
      ? evidenceTasks.map((task) => task.check_key)
      : candidate.inferred_required_checks ?? inferredRequiredChecksForCandidate(candidate)
    ).join(", "),
    policyAliases: (candidate.inferred_policy_aliases ?? inferPolicyAliasesForCandidate(candidate)).join(", "),
    evidenceTasks
  };
}

export function evidenceTasksForCandidate(candidate: { evidence_tasks?: EvidenceTaskSpec[]; metadata: Record<string, unknown> }) {
  if (candidate.evidence_tasks) return candidate.evidence_tasks;
  return evidenceTasksFromUnknown(candidate.metadata.evidence_tasks);
}

export function evidenceTasksFromSkill(skill: SkillRecord) {
  if (skill.evidence_tasks) return skill.evidence_tasks;
  return evidenceTasksFromUnknown(skill.config.evidence_tasks);
}

export function evidenceSkillOptionsFromSkills(skills: SkillRecord[]): EvidenceSkillOption[] {
  return skills
    .flatMap((skill) => {
      if (skill.category !== "evidence" || skill.status !== "active" || skill.version_status !== "active") return [];
      const checkKey = stringFrom(skill.config.check_key);
      const sideEffectLevel = stringFrom(skill.config.side_effect_level);
      const skillType = stringFrom(skill.config.skill_type);
      if (!checkKey || sideEffectLevel !== "read_only" || skillType !== "evidence") return [];
      return [
        {
          skill_id: skill.skill_id,
          name: skill.name,
          check_key: checkKey
        }
      ];
    })
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id));
}

export function evidenceTasksFromUnknown(value: unknown): EvidenceTaskSpec[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = recordFrom(entry);
    const checkKey = stringFrom(record.check_key);
    const label = stringFrom(record.label);
    const evidenceSkillId = stringFrom(record.evidence_skill_id);
    const instructions = stringFrom(record.instructions) ?? "";
    const allowedActions = stringArray(record.allowed_actions);
    if (!checkKey || !label || (!evidenceSkillId && (!instructions || allowedActions.length === 0))) return [];
    return [
      {
        check_key: checkKey,
        label,
        ...(evidenceSkillId ? { evidence_skill_id: evidenceSkillId } : {}),
        instructions,
        success_criteria: stringArray(record.success_criteria),
        allowed_actions: allowedActions,
        target_files: stringArray(record.target_files)
      }
    ];
  });
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

export function evidenceCheckOptionsFromSkills(skills: SkillRecord[]): EvidenceCheckOption[] {
  const registered = skills.flatMap((skill) => {
    const checkKey = checkKeyFromSkill(skill);
    if (!checkKey) return [];
    return [
      {
        key: checkKey,
        label: skill.name,
        description: skill.description ?? `Registered evidence skill ${skill.skill_id}.`,
        source: "registered" as const
      }
    ];
  });
  const byKey = new Map<string, EvidenceCheckOption>();
  for (const option of builtInEvidenceCheckOptions) byKey.set(option.key, option);
  for (const option of registered) byKey.set(option.key, option);
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
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

function checkKeyFromSkill(skill: SkillRecord) {
  const configCheck = stringFrom(skill.config.check_key);
  const executionCheck = stringFrom(skill.execution.check_key);
  if (configCheck) return configCheck;
  if (executionCheck) return executionCheck;
  return skill.category === "evidence" ? stringFrom(skill.config.required_check) : null;
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

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
