# Demo Script

1. Run `pnpm demo:setup`, then `pnpm dev`.
2. Optional reset between takes: `pnpm demo:reset`.
3. Open `/live` and point to the three journey modes: without AgentGate, observe mode, and enforce mode.
4. Run `pnpm demo:run merge_pr_with_agentgate`.
5. Show that the PR merge produces a durable run, evidence, approval, scoped token, execution logs, and audit finalization.
6. Open `/risk-scanner`.
7. Simulate `safe_tests`, `create_pr`, `merge_main`, `production_deploy`, `production_db_migration`, `research_agent_deploy`, and `mcp_drop_table`.
8. Confirm the scanner previews resolved skill, risk, matching policy, checks, decision, and zero side effects.
9. Run `pnpm demo:run production_deploy_with_agentgate`.
10. Confirm production deployment requires evidence, approval, token issuance, execution, logs, and audit.
11. Run `pnpm demo:run production_db_migration_with_agentgate`.
12. Confirm production database migration is forced through dry-run evidence before approval.
13. Run `pnpm demo:run deny_destructive_action`.
14. Confirm destructive table drop is denied without approval, token, or execution.
15. Run `pnpm demo:run retry_failed_execution`.
16. Confirm the first execution fails, the retry gets a new token, and final audit remains complete.
17. Open `/audit/<trace_id>` from any terminal output and verify the audit trace is complete.

Golden scenario IDs:

- `merge_pr_with_agentgate`
- `production_deploy_with_agentgate`
- `production_db_migration_with_agentgate`
- `deny_destructive_action`
- `retry_failed_execution`

Production deployment, database mutation, Vercel mutation, Kubernetes mutation, and GitHub merges remain simulated. Decisions, approvals, dry-run evidence, tokens, attempts, logs, and audit events are real Postgres records.
