import type { ResolvedSkill } from "@agentgate/core-types";
import { canonicalSkillMatchers, destructiveProductionPatterns } from "./matchers";

export type ResolveSkillInput = {
  rawAction: string;
  toolName?: string;
  context?: {
    environment?: string;
  };
};

export function resolveSkill(input: ResolveSkillInput): ResolvedSkill {
  const haystack = [input.rawAction, input.toolName].filter(Boolean).join(" ").toLowerCase();
  const match = canonicalSkillMatchers.find((candidate) =>
    haystack.includes(candidate.pattern.toLowerCase())
  );

  if (!match) {
    const looksDestructive = destructiveProductionPatterns.some((pattern) =>
      haystack.includes(pattern)
    );

    return {
      skill_id: looksDestructive ? "unknown-destructive" : "unknown",
      skill_version: "0.0.0",
      category: "unknown",
      default_risk_level: looksDestructive ? "critical" : "medium",
      confidence: looksDestructive ? 0.7 : 0.3,
      resolver_reason: looksDestructive
        ? "Raw action matched destructive production pattern."
        : "Raw action did not match a known AgentGate skill mapping.",
      resolver_source: "static_fallback"
    };
  }

  return {
    skill_id: match.skill_id,
    skill_version: "1.0.0",
    category: match.category,
    default_risk_level: match.default_risk_level,
    confidence: 1,
    resolver_reason: "Raw action matched a canonical AgentGate skill mapping.",
    resolver_source: "static_fallback",
    matched_pattern: match.pattern
  };
}

export function resolveSkillPlaceholder(rawAction: string): ResolvedSkill {
  return resolveSkill({ rawAction });
}
