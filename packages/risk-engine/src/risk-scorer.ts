import type { RiskLevel } from "@agentgate/core-types";

export type RiskScorePreview = {
  score: number;
  level: RiskLevel;
};

export function classifyRiskScore(score: number): RiskLevel {
  if (score >= 85) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function createRiskPreview(score: number): RiskScorePreview {
  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    level: classifyRiskScore(clamped)
  };
}
