# AgentGate Claude Instructions

AgentGate is the governance layer for this project. Use it before attempting risky or production-like work.

## Governed Actions

Before taking any of these actions, call the AgentGate MCP tool first:

- Production or staging deployments
- Database migrations, schema changes, table drops, destructive SQL, or production data changes
- Pull request merges, especially into `main`
- GitHub, Vercel, Kubernetes, cloud, database, or external MCP mutation tools
- Any command that includes `production`, `prod`, `--prod`, `deploy`, `migrate`, `drop`, `delete`, `truncate`, `destroy`, or `merge`

Use these AgentGate MCP tools as the normal path:

- `agentgate_run_tests` for test runs
- `agentgate_create_pr` for pull request creation
- `agentgate_merge_pr` for pull request merges
- `agentgate_apply_migration` for database migrations
- `agentgate_drop_table` for destructive table operations
- `agentgate_deploy_staging` for staging deploys
- `agentgate_deploy_production` for production deploys
- `agentgate_replay_demo_action` for PRD demo fixture replays
- `agentgate_get_run` and `agentgate_get_audit_trace` to inspect governance results

## Decision Handling

- If AgentGate returns `ALLOW`, continue with the requested safe local action only when it is still needed.
- If AgentGate returns `REQUIRE_APPROVAL`, stop and report the approval requirement, run ID, trace ID, and reason.
- If AgentGate returns `FORCE_DRY_RUN`, stop and report the dry-run requirement, run ID, trace ID, and reason.
- If AgentGate returns `DENY`, stop and report the denial reason.

Do not try to bypass AgentGate by directly running raw Bash, GitHub, Vercel, database, Kubernetes, or MCP mutation commands after a blocking decision.

## Claude Hook Safety Net

The project also has a Claude `PreToolUse` hook. Treat it as a safety net, not the primary workflow. For risky user intent such as "trigger vercel deployment prod", call `agentgate_deploy_production` first instead of inspecting deployment setup or trying a raw deploy command.

Safe read-only inspection commands such as `git status`, `git diff`, `ls`, `rg`, and project file reads may be used normally.

## Local Runtime

AgentGate decisions require the local API:

```sh
WEB_PORT=3001 pnpm dev
```

The API runs on `http://localhost:4000`. The dashboard usually runs on `http://localhost:3001` because port `3000` may already be in use.
