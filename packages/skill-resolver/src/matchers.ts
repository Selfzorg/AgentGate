export type SkillMatcher = {
  pattern: string;
  skill_id: string;
  category: string;
};

export const phaseZeroSkillMatchers: SkillMatcher[] = [
  { pattern: "pnpm test", skill_id: "run-tests", category: "code_quality" },
  { pattern: "npm test", skill_id: "run-tests", category: "code_quality" },
  { pattern: "gh pr create", skill_id: "create-pr", category: "source_control" },
  { pattern: "gh pr merge", skill_id: "merge-pr", category: "source_control" },
  { pattern: "vercel deploy --prod", skill_id: "deploy-production", category: "deployment" },
  { pattern: "deploy production", skill_id: "deploy-production", category: "deployment" },
  { pattern: "npm run deploy:staging", skill_id: "deploy-staging", category: "deployment" },
  { pattern: "npm run migrate:prod", skill_id: "run-db-migration", category: "database" },
  { pattern: "alembic upgrade head", skill_id: "run-db-migration", category: "database" },
  { pattern: "mcp.github.merge_pr", skill_id: "merge-pr", category: "source_control" },
  { pattern: "mcp.postgres.apply_migration", skill_id: "run-db-migration", category: "database" },
  { pattern: "mcp.postgres.drop_table", skill_id: "drop-table", category: "database" }
];
