import type { ResolvedSkill } from "@agentgate/core-types";
import { phaseZeroSkillMatchers } from "./matchers";

export function resolveSkillPlaceholder(rawAction: string): ResolvedSkill {
  const normalized = rawAction.toLowerCase();
  const match = phaseZeroSkillMatchers.find((candidate) =>
    normalized.includes(candidate.pattern.toLowerCase())
  );

  if (!match) {
    return {
      skill_id: "unknown-destructive",
      skill_version: "0.0.0",
      category: "unknown",
      default_risk_level: "critical",
      confidence: 0.7,
      resolver_reason: "Phase 0 placeholder resolver did not find a known mapping."
    };
  }

  return {
    skill_id: match.skill_id,
    skill_version: "1.0.0",
    category: match.category,
    default_risk_level:
      match.skill_id === "run-tests" || match.skill_id === "create-pr"
        ? "low"
        : match.skill_id === "deploy-staging"
          ? "medium"
          : match.skill_id === "drop-table" || match.skill_id === "run-db-migration"
            ? "critical"
            : "high",
    confidence: 1,
    resolver_reason: "Phase 0 placeholder resolver matched a PRD mapping.",
    matched_pattern: match.pattern
  };
}
