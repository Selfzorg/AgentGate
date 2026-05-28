export type SkillMatcher = {
  pattern: string;
  skill_id: string;
  category: string;
  default_risk_level: "low" | "medium" | "high" | "critical";
};

export const canonicalSkillMatchers: SkillMatcher[] = [
  { pattern: "npm test", skill_id: "run-tests", category: "code_quality", default_risk_level: "low" },
  { pattern: "pnpm test", skill_id: "run-tests", category: "code_quality", default_risk_level: "low" },
  { pattern: "gh pr create", skill_id: "create-pr", category: "source_control", default_risk_level: "low" },
  { pattern: "gh pr merge", skill_id: "merge-pr", category: "source_control", default_risk_level: "high" },
  { pattern: "vercel deploy --prod", skill_id: "deploy-production", category: "deployment", default_risk_level: "high" },
  { pattern: "deploy production", skill_id: "deploy-production", category: "deployment", default_risk_level: "high" },
  { pattern: "npm run deploy:staging", skill_id: "deploy-staging", category: "deployment", default_risk_level: "medium" },
  { pattern: "npm run migrate:prod", skill_id: "run-db-migration", category: "database", default_risk_level: "critical" },
  { pattern: "alembic upgrade head", skill_id: "run-db-migration", category: "database", default_risk_level: "critical" },
  { pattern: "mcp.github.merge_pr", skill_id: "merge-pr", category: "source_control", default_risk_level: "high" },
  { pattern: "mcp.postgres.apply_migration", skill_id: "run-db-migration", category: "database", default_risk_level: "critical" },
  { pattern: "mcp.postgres.drop_table", skill_id: "drop-table", category: "database", default_risk_level: "critical" },
  { pattern: "mcp.agentgate.agentgate_run_tests", skill_id: "run-tests", category: "code_quality", default_risk_level: "low" },
  { pattern: "mcp.agentgate.agentgate_create_pr", skill_id: "create-pr", category: "source_control", default_risk_level: "low" },
  { pattern: "mcp.agentgate.agentgate_merge_pr", skill_id: "merge-pr", category: "source_control", default_risk_level: "high" },
  { pattern: "mcp.agentgate.agentgate_apply_migration", skill_id: "run-db-migration", category: "database", default_risk_level: "critical" },
  { pattern: "mcp.agentgate.agentgate_drop_table", skill_id: "drop-table", category: "database", default_risk_level: "critical" },
  { pattern: "mcp.agentgate.agentgate_deploy_staging", skill_id: "deploy-staging", category: "deployment", default_risk_level: "medium" },
  { pattern: "mcp.agentgate.agentgate_deploy_production", skill_id: "deploy-production", category: "deployment", default_risk_level: "high" }
];

export const destructiveProductionPatterns = [
  "drop",
  "delete",
  "destroy",
  "truncate",
  "migrate:prod",
  "production"
] as const;
