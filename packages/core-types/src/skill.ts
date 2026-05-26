import type { RiskLevel } from "./enums";

export type ResolvedSkill = {
  skill_id: string;
  skill_version: string;
  category: string;
  default_risk_level: RiskLevel;
  confidence: number;
  resolver_reason: string;
  matched_pattern?: string;
};

export type SkillInput = {
  skill_id: string;
  raw_action: string;
  context: Record<string, unknown>;
};
