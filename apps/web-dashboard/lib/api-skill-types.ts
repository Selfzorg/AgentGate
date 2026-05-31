import type { DecisionResponse } from "./api-demo-types";

export type SkillRecord = {
  id: string;
  skill_id: string;
  name: string;
  category: string;
  default_risk_level: "low" | "medium" | "high" | "critical";
  description: string | null;
  status: string;
  version: string;
  version_status: string;
  connector: string | null;
  config: Record<string, unknown>;
  execution: Record<string, unknown>;
  evidence_tasks?: EvidenceTaskSpec[];
};

export type EvidenceTaskSpec = {
  check_key: string;
  label: string;
  evidence_skill_id?: string;
  instructions: string;
  success_criteria: string[];
  allowed_actions: string[];
  target_files: string[];
};

export type SkillImportCandidate = {
  id: string;
  candidate_id: string;
  skill_id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_path: string;
  relative_path: string;
  scope: string;
  content_hash: string;
  declared_tools: string[];
  skill_type: string;
  side_effect_level: string;
  default_risk_level: "low" | "medium" | "high" | "critical";
  allowed_runtimes: string[];
  preferred_runtimes: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
  evidence_tasks?: EvidenceTaskSpec[];
  inferred_policy_aliases?: string[];
  inferred_required_checks?: string[];
  required_evidence_raw?: string[];
  evidence_warnings?: string[];
  review_status: string;
  imported_skill_record_id: string | null;
  imported_skill_version_id: string | null;
  review_notes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SkillImportBatch = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  root_dir: string;
  status: string;
  candidate_count: number;
  warning_count: number;
  scan_config: Record<string, unknown>;
  warnings: string[];
  requested_by: string | null;
  reviewed_by: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  candidates?: SkillImportCandidate[];
};

export type SkillRegistryScan = {
  rootDir: string;
  scannedAt: string;
  candidates: Array<{
    id: string;
    skillId: string;
    name: string;
    description: string | null;
    sourceType: string;
    scope: string;
    sourcePath: string;
    relativePath: string;
    contentHash: string;
    declaredTools: string[];
    skillType: string;
    sideEffectLevel: string;
    defaultRiskLevel: "low" | "medium" | "high" | "critical";
    allowedRuntimes: string[];
    preferredRuntimes: string[];
    warnings: string[];
    metadata: Record<string, unknown>;
  }>;
  warnings: string[];
  duplicateGroups: Array<{
    normalizedName: string;
    candidates: Array<{
      id: string;
      skillId: string;
      name: string;
      sourceType: string;
      scope: string;
      relativePath: string;
      contentHash: string;
    }>;
  }>;
  summary: {
    total: number;
    bySourceType: Record<string, number>;
    byRiskLevel: Record<string, number>;
    bySideEffectLevel: Record<string, number>;
    warningCount: number;
  };
};

export type PolicyRecord = {
  id: string;
  policy_id: string;
  name: string;
  version: string;
  priority: number;
  decision: DecisionResponse["decision"];
  reason: string;
  definition: Record<string, unknown>;
  required_checks: unknown;
  approvers: unknown;
};
