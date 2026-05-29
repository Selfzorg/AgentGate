import type { RiskLevel } from "@agentgate/core-types";
import type { ResolvedSkill } from "@agentgate/core-types";

export type RiskScorePreview = {
  score: number;
  level: RiskLevel;
};

export type RiskScoringContext = {
  environment?: "dev" | "staging" | "production";
  target_branch?: string;
  database?: string;
  ci_status?: "passed" | "failed" | "unknown";
  tests_status?: "passed" | "failed" | "unknown";
  rollback_plan?: "exists" | "missing" | "unknown";
  staging_deploy?: "success" | "failed" | "unknown";
  dry_run_completed?: boolean;
};

export type RiskScoreResult = {
  risk_score: number;
  risk_level: RiskLevel;
  risk_reasons: string[];
};

const baseScores: Record<string, number> = {
  "run-tests": 10,
  "create-pr": 25,
  "merge-pr": 60,
  "deploy-staging": 45,
  "deploy-production": 80,
  "run-db-migration": 90,
  "drop-table": 100,
  "unknown-destructive": 95,
  unknown: 50
};

const riskLevelBaseScores: Record<RiskLevel, number> = {
  low: 15,
  medium: 45,
  high: 70,
  critical: 90
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

export function scoreRisk({
  resolvedSkill,
  rawAction,
  context
}: {
  resolvedSkill: ResolvedSkill;
  rawAction: string;
  context: RiskScoringContext;
}): RiskScoreResult {
  const reasons: string[] = [];
  const lowerAction = rawAction.toLowerCase();
  const scoreSource = baseScoreSourceFor(resolvedSkill);
  let score = scoreSource.score;

  reasons.push(`Base score ${score} for ${scoreSource.skillId}.`);

  if (context.environment === "production") {
    score += 10;
    reasons.push("Production environment adds risk.");
  }

  if (context.target_branch === "main") {
    score += 10;
    reasons.push("Main branch target adds risk.");
  }

  if (
    context.database ||
    resolvedSkill.skill_id === "run-db-migration" ||
    resolvedSkill.skill_id === "drop-table"
  ) {
    score += 10;
    reasons.push("Database write capability adds risk.");
  }

  if (
    resolvedSkill.skill_id === "drop-table" ||
    resolvedSkill.skill_id === "unknown-destructive" ||
    /\b(drop|delete|destroy|truncate)\b/.test(lowerAction)
  ) {
    score += 20;
    reasons.push("Destructive action pattern adds risk.");
  }

  if (context.rollback_plan === "missing") {
    score += 10;
    reasons.push("Missing rollback plan adds risk.");
  }

  if (context.ci_status === "failed") {
    score += 15;
    reasons.push("Failed CI adds risk.");
  }

  if (context.tests_status === "failed") {
    score += 15;
    reasons.push("Failed tests add risk.");
  }

  if (context.dry_run_completed === true) {
    score -= 10;
    reasons.push("Completed dry-run reduces risk.");
  }

  if (context.staging_deploy === "success") {
    score -= 5;
    reasons.push("Successful staging deploy reduces risk.");
  }

  const risk_score = Math.max(0, Math.min(100, score));

  return {
    risk_score,
    risk_level: classifyRiskScore(risk_score),
    risk_reasons: reasons
  };
}

function baseScoreSourceFor(resolvedSkill: ResolvedSkill): { skillId: string; score: number } {
  const aliases = Array.isArray(resolvedSkill.policy_aliases) ? resolvedSkill.policy_aliases : [];
  for (const skillId of [resolvedSkill.skill_id, ...aliases]) {
    const score = baseScores[skillId];
    if (score === undefined) continue;
    return {
      skillId,
      score
    };
  }

  return {
    skillId: resolvedSkill.skill_id,
    score: riskLevelBaseScores[resolvedSkill.default_risk_level] ?? 50
  };
}
