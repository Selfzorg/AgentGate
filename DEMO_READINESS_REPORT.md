# Demo Readiness Report

## Status

AgentGate V5 MVP demo readiness: ready after the stacked PRs are merged in order.

## Implemented Features

- Schema-first Postgres source of truth for tenants, workspaces, agents, skills, policies, runs, approvals, dry-runs, tokens, attempts, logs, audit events, and artifacts.
- Fixture-backed demo actions and policies loaded from `configs/demo-actions.yaml` and `configs/demo-policies.yaml`.
- Decision pipeline for `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, and `FORCE_DRY_RUN`.
- Approval packets with gate checks and dry-run evidence.
- Hash-only execution tokens with scoped token summaries in the browser.
- DB-backed execution queue and single-process runner loop.
- Demo connectors for GitHub, deployment, and database actions with simulated side effects.
- SSE execution log replay and live activity.
- Read-only policy simulation risk scanner.
- Audit trace completeness validation and UI status.
- Runner retry, failure, revoked/used/expired token, duplicate idempotency, and log sequence hardening.

## Commands Run

All checks passed on the final PR4 baseline before PR5 documentation changes:

```sh
pnpm exec vitest run tests/runner-hardening.test.ts
pnpm exec vitest run tests/runner-hardening.test.ts tests/phase3.test.ts tests/audit-integrity.test.ts
pnpm lint
pnpm typecheck
pnpm test
```

Additional focused checks passed during the stack:

```sh
pnpm exec vitest run tests/phase3.test.ts
pnpm exec vitest run tests/risk-scanner.test.ts
pnpm exec vitest run tests/phase3.test.ts tests/risk-scanner.test.ts
pnpm exec vitest run tests/audit-integrity.test.ts
```

Browser smoke checks passed for:

- `/risk-scanner`: safe action and production deploy simulations rendered with no console errors.
- `/audit/<trace_id>`: complete and incomplete trace status rendered with no console errors.

## Exact Demo Script

1. Run `pnpm postgres:start`.
2. Run `pnpm db:seed`.
3. Run `pnpm dev`.
4. Open `http://localhost:3000/risk-scanner`; use `WEB_PORT=3001 pnpm --filter @agentgate/web-dashboard dev` if 3000 is busy.
5. Simulate each sample action: safe tests, create PR, merge main, production deploy, production DB migration, research deploy, MCP drop table.
6. Open `/live` and replay the governed execution scenario.
7. Open `/approvals`, review pending approval evidence, and approve a ready production action.
8. Open the skill run detail page, issue a scoped token, queue execution, and watch SSE logs finish.
9. Open `/audit/<trace_id>` and show the complete trace badge.
10. Optionally open an incomplete trace to show missing lifecycle event reporting.

## Routes

- `GET /health`
- `POST /api/v1/decision`
- `GET /api/v1/demo/actions`
- `POST /api/v1/demo/actions/:action_id/replay`
- `POST /api/v1/demo/scenario/replay`
- `GET /api/v1/risk-scanner/samples`
- `POST /api/v1/risk-scanner/simulate`
- `GET /api/v1/approvals`
- `POST /api/v1/approvals/:approval_id/approve`
- `POST /api/v1/approvals/:approval_id/deny`
- `POST /api/v1/approvals/:approval_id/force-dry-run`
- `GET /api/v1/skill-runs`
- `GET /api/v1/skill-runs/:run_id`
- `POST /api/v1/skill-runs/:run_id/dry-run`
- `POST /api/v1/skill-runs/:run_id/execute`
- `POST /api/v1/skill-runs/:run_id/retry`
- `GET /api/v1/skill-runs/:run_id/logs`
- `POST /api/v1/execution-tokens`
- `GET /api/v1/audit-events`
- `GET /api/v1/audit-integrity`
- `GET /api/v1/live/activity`
- `GET /api/v1/skills`
- `GET /api/v1/policies`

## PRD Coverage

- Governance decisions are persisted with risk, policy, checks, approvals, dry-run evidence, tokens, attempts, logs, and audit events.
- Queue state is Postgres-backed through `skill_runs.status` and runner claims.
- Raw token material is never returned; only token IDs, status, scopes, expiry, and timestamps reach the browser.
- Production mutations remain simulated while governance state is real.
- Demo actions are loaded through config-backed API routes instead of hardcoded dashboard data.
- Redis, BullMQ, Kafka, and Docker are not used.

## Known Limits

- Connectors simulate GitHub, deployment, and database side effects.
- The MVP uses one API runtime that imports the runner loop during `pnpm dev`.
- Local tests require Homebrew Postgres on `localhost:5432`.
- No GitHub Actions workflow was added because the repository had no existing `.github/workflows` convention to extend.

## Risks

- Local port 3000 may be occupied; use `WEB_PORT=3001` for the dashboard.
- Broad runner scans are still used in the demo scenario route by design; tests use by-run processing to avoid cross-file interference.
- Retry is explicit: failed runs need a fresh token and `/retry`, not a normal `/execute`.

## PR Stack

| PR | Branch | Target | URL |
| --- | --- | --- | --- |
| PR1 | `feature/01-governance-test-harness` | `codex/agentgate-v5-phase-3` | https://github.com/Selfzorg/AgentGate/pull/3 |
| PR2 | `feature/02-policy-simulation-risk-scanner` | `feature/01-governance-test-harness` | https://github.com/Selfzorg/AgentGate/pull/4 |
| PR3 | `feature/03-audit-integrity-hardening` | `feature/02-policy-simulation-risk-scanner` | https://github.com/Selfzorg/AgentGate/pull/5 |
| PR4 | `feature/04-runner-failure-retry-idempotency-hardening` | `feature/03-audit-integrity-hardening` | https://github.com/Selfzorg/AgentGate/pull/6 |
| PR5 | `feature/05-demo-readiness-ci-report` | `feature/04-runner-failure-retry-idempotency-hardening` | https://github.com/Selfzorg/AgentGate/pull/7 |

## Morning Merge Order

1. Merge PR1.
2. Merge PR2.
3. Merge PR3.
4. Merge PR4.
5. Merge PR5.
