import type { RiskLevel } from "./enums";

export type ResolvedSkill = {
  skill_id: string;
  skill_version: string;
  category: string;
  default_risk_level: RiskLevel;
  confidence: number;
  resolver_reason: string;
  matched_pattern?: string;
  resolver_source?: "imported_registry" | "static_fallback";
  matched_field?: "skill_id" | "name" | "path" | "declared_tool" | "description";
  policy_aliases?: string[];
  required_checks?: string[];
  source_fingerprint?: {
    source_type: string;
    path: string;
    content_hash: string;
    skill_version_id?: string | null;
  };
  alternatives?: Array<{
    skill_id: string;
    confidence: number;
    matched_field: "skill_id" | "name" | "path" | "declared_tool" | "description";
  }>;
};

export type SkillInput = {
  skill_id: string;
  raw_action: string;
  context: Record<string, unknown>;
};
