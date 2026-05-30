# Demo Script

For a fresh-clone judge path, use the root [DEMO.md](../DEMO.md). This script is the presenter checklist once the app is already running.

1. Run `pnpm demo:setup`, then `pnpm dev`.
2. Optional reset between takes: `pnpm demo:reset`.
3. Open `/live` and point to the three journey modes: without AgentGate, observe mode, and enforce mode.
4. Open `/skills`, leave Skill Root empty for the repo default or paste a downloaded skills folder, then click Scan Skills.
5. Create Review Snapshot, inspect policy aliases and required evidence in the candidate detail panel, then approve selected skills.
6. Open `/risk-scanner`, choose an approved imported skill, click Build Simulation Payload, then Simulate Policy.
7. Confirm the scanner previews resolved skill, risk, matching policy, checks, decision, and zero side effects.
8. Run `pnpm demo:run merge_pr_with_agentgate`.
9. Show that the PR merge produces a durable run, evidence, approval, scoped token, execution logs, and audit finalization.
10. Run `pnpm demo:run production_deploy_with_agentgate`.
11. Confirm production deployment requires evidence, approval, token issuance, execution, logs, and audit.
12. From `/approvals`, approve a ready packet and use Continue Execution to reach the run page.
13. For imported Claude skills, click Continue in Claude and paste the command into Claude Code. Claude receives the approved skill body and must call `pnpm exec agentgate claude complete --run-id <run_id> --status completed` after execution.
14. Run `pnpm demo:run production_db_migration_with_agentgate`.
15. Confirm production database migration is forced through dry-run evidence before approval.
16. Run `pnpm demo:run deny_destructive_action`.
17. Confirm destructive table drop is denied without approval, token, or execution.
18. Run `pnpm demo:run retry_failed_execution`.
19. Confirm the first execution fails, the retry gets a new token, and final audit remains complete.
20. Open `/audit/<trace_id>` from any terminal output and verify the audit trace is complete.

Golden scenario IDs:

- `merge_pr_with_agentgate`
- `production_deploy_with_agentgate`
- `production_db_migration_with_agentgate`
- `deny_destructive_action`
- `retry_failed_execution`

Production deployment, database mutation, Vercel mutation, Kubernetes mutation, and GitHub merges remain simulated unless an imported Claude skill is explicitly continued in Claude Code. Decisions, approvals, dry-run evidence, tokens, Claude handoff attempts, logs, and audit events are real Postgres records.
