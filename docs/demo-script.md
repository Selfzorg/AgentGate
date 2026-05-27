# Demo Script

1. Start Postgres, seed fixtures, and run `pnpm dev`.
2. Open `/risk-scanner`.
3. Simulate `safe_tests`, `create_pr`, `merge_main`, `production_deploy`, `production_db_migration`, `research_agent_deploy`, and `mcp_drop_table`.
4. Confirm the scanner previews resolved skill, risk, matching policy, checks, decision, and zero side effects.
5. Open `/live`.
6. Replay the Phase 3 governed execution scenario.
7. Confirm safe test and pull request actions are allowed.
8. Confirm main branch merge requires approval.
9. Confirm production database migration is forced through dry-run evidence before approval.
10. Confirm production deployment requires approval.
11. Open `/approvals` and approve a ready production action with a comment.
12. Open the skill run detail page, issue a scoped execution token, and queue execution.
13. Watch persisted execution logs stream over SSE until completion.
14. Open `/audit/<trace_id>` and verify the audit trace is complete.
15. Demonstrate an incomplete trace if useful by opening a trace that has not completed execution.

Production deployment, database mutation, Vercel mutation, Kubernetes mutation, and GitHub merges remain simulated. Decisions, approvals, dry-run evidence, tokens, attempts, logs, and audit events are real Postgres records.
