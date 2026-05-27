# Home Testing Handoff

## Status

Release QA result: the AgentGate v5 stacked PRs are reviewable, locally mergeable, demo-ready, and consistent with the locked PRD MVP constraints.

No product bugs were found. No code fixes were needed. The only PR metadata fix was updating PR5's GitHub description so it includes the requested Test Plan, Changed Files, and Risks / Notes sections.

## PR Order

| Order | PR | Branch | Target | Status |
| --- | --- | --- | --- | --- |
| 1 | https://github.com/Selfzorg/AgentGate/pull/3 | `feature/01-governance-test-harness` | `codex/agentgate-v5-phase-3` | Open draft, mergeable |
| 2 | https://github.com/Selfzorg/AgentGate/pull/4 | `feature/02-policy-simulation-risk-scanner` | `feature/01-governance-test-harness` | Open draft, mergeable |
| 3 | https://github.com/Selfzorg/AgentGate/pull/5 | `feature/03-audit-integrity-hardening` | `feature/02-policy-simulation-risk-scanner` | Open draft, mergeable |
| 4 | https://github.com/Selfzorg/AgentGate/pull/6 | `feature/04-runner-failure-retry-idempotency-hardening` | `feature/03-audit-integrity-hardening` | Open draft, mergeable |
| 5 | https://github.com/Selfzorg/AgentGate/pull/7 | `feature/05-demo-readiness-ci-report` | `feature/04-runner-failure-retry-idempotency-hardening` | Open draft, mergeable |

PR1 through PR4 are one focused commit each on top of their parent branches. PR5 is documentation/readiness focused and now contains the original readiness commit plus this QA handoff commit. PR2 is the largest slice because it contains the risk scanner API/service/UI and focused tests, but it remains scoped to read-only simulation.

## PR Description QA

| PR | Required sections | UI change notes |
| --- | --- | --- |
| PR1 | Summary, Test Plan, Changed Files, Risks / Notes | No UI change |
| PR2 | Summary, Test Plan, Changed Files, Risks / Notes | Browser smoke note for `/risk-scanner` included |
| PR3 | Summary, Test Plan, Changed Files, Risks / Notes | Browser smoke note for `/audit/<traceId>` included |
| PR4 | Summary, Test Plan, Changed Files, Risks / Notes | No UI change |
| PR5 | Summary, Test Plan, Changed Files, Risks / Notes | No UI files changed; note included |

## Commands Run Per PR Branch

Each branch was checked out locally, reseeded, then verified with the standard command trio.

| PR | Branch | Commands | Result |
| --- | --- | --- | --- |
| PR1 | `feature/01-governance-test-harness` | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 4 files / 25 tests |
| PR2 | `feature/02-policy-simulation-risk-scanner` | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 5 files / 28 tests |
| PR3 | `feature/03-audit-integrity-hardening` | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 6 files / 31 tests |
| PR4 | `feature/04-runner-failure-retry-idempotency-hardening` | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 7 files / 34 tests |
| PR5 | `feature/05-demo-readiness-ci-report` | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm test:governance` | Pass, full 7 files / 34 tests; governance 4 files / 21 tests |

## Integration Branch

Temporary local branch: `codex/home-release-qa-final-20260527`

Created from `codex/agentgate-v5-phase-3`, then merged in order:

```sh
git checkout -b codex/home-release-qa-final-20260527 codex/agentgate-v5-phase-3
git merge --no-ff --no-edit feature/01-governance-test-harness
git merge --no-ff --no-edit feature/02-policy-simulation-risk-scanner
git merge --no-ff --no-edit feature/03-audit-integrity-hardening
git merge --no-ff --no-edit feature/04-runner-failure-retry-idempotency-hardening
git merge --no-ff --no-edit feature/05-demo-readiness-ci-report
```

Merge result: clean, no conflicts.

Integration verification:

```sh
test -d node_modules && test -f pnpm-lock.yaml
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm test:governance
pnpm verify
```

Result:

- `node_modules` and `pnpm-lock.yaml` were present, so install was not needed.
- `pnpm db:generate` passed.
- `pnpm db:migrate` passed with "Already in sync" after rerunning with local Postgres access outside the sandbox.
- `pnpm db:seed` passed.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed, 7 files / 34 tests.
- `pnpm test:governance` passed, 4 files / 21 tests.
- `pnpm verify` passed.

## API Smoke

The API was started locally on port 4101:

```sh
API_PORT=4101 pnpm --filter @agentgate/api-server dev
```

The HTTP smoke asserted:

- `GET /health` returns phase 3 health.
- `GET /api/v1/demo/actions` returns the same action IDs as `configs/demo-actions.yaml`.
- `POST /api/v1/demo/actions/safe_tests/replay` returns `ALLOW`.
- `POST /api/v1/demo/actions/research_agent_deploy/replay` returns `DENY`.
- `POST /api/v1/demo/actions/production_deploy/replay` returns `REQUIRE_APPROVAL`.
- `POST /api/v1/demo/actions/production_db_migration/replay` returns `FORCE_DRY_RUN`.
- `POST /api/v1/demo/scenario/replay` ran the governed scenario; queued rows were completed by the DB-backed runner loop and scenario scan.
- `GET /api/v1/skill-runs/:run_id` showed the production deploy run completed and exposed only token metadata fields.
- `GET /api/v1/skill-runs/:run_id/logs` streamed persisted `execution_log` and `execution_completed` SSE events.
- `GET /api/v1/audit-integrity?skill_run_id=:run_id` returned `complete: true`.

Observed smoke summary:

```json
{
  "yaml_action_ids": [
    "safe_tests",
    "create_pr",
    "merge_main",
    "production_deploy",
    "research_agent_deploy",
    "production_db_migration",
    "mcp_drop_table"
  ],
  "replay_decisions": [
    "safe_tests:ALLOW",
    "research_agent_deploy:DENY",
    "production_deploy:REQUIRE_APPROVAL",
    "production_db_migration:FORCE_DRY_RUN"
  ],
  "scenario_runner": "claimed remaining queued rows; exact count can vary because the API starts the internal runner loop during dev",
  "production_deploy_status": "completed",
  "sse_events_seen": [
    "execution_log",
    "execution_completed"
  ],
  "audit_integrity_complete": true,
  "audit_event_count": 17
}
```

## Regression Search

Searched for:

- raw token exposure: `tokenHash`, `token_hash`, `raw_token`, raw secret patterns
- hardcoded demo action IDs in the dashboard
- Redis/BullMQ/Kafka/NATS/RabbitMQ dependencies
- real production mutation calls or shell execution hooks
- frontend-only fake execution

Result:

- Token hashes are limited to schema/storage and tests that assert non-exposure.
- Browser-facing token responses expose only `id`, `status`, `scopes`, `environment`, approval ID, expiry, usage, revocation, and creation timestamps.
- Demo action IDs are not independently hardcoded in the React launcher; dashboard loads actions via API.
- No Redis, BullMQ, Kafka, or NATS dependency exists.
- No real deployment, database mutation, Vercel mutation, Kubernetes mutation, or GitHub merge is executed. Demo connectors simulate side effects.
- Execution is DB-backed through `skill_runs.status`, attempts, logs, and audit events.

## Bugs Found And Fixes Made

- PR5 description was missing the exact checklist headings. Fixed on GitHub by replacing `Verification` / `Notes` with `Test Plan`, `Changed Files`, and `Risks / Notes`.
- `gh` CLI is not installed in this environment. Used the GitHub connector for PR metadata instead.
- Prisma migrate initially failed inside the sandbox because the schema engine could not reach local Postgres. Rerun outside the sandbox passed and reported the schema was already in sync.
- The first HTTP smoke script sent `content-type: application/json` with an empty body and Fastify correctly returned 400. The smoke script was corrected to send `{}`. No app change was needed.

## Remaining Blockers

No release blocker found.

Operational notes:

- Local Postgres must be running on `localhost:5432`.
- Port 3000 may be occupied; use `WEB_PORT=3001` for the dashboard if needed.
- No GitHub Actions workflow was added because the repo has no `.github/workflows` convention yet.
- Production-impacting side effects are simulated by PRD design.

## Steps To Run At Home

```sh
git fetch origin
git checkout feature/05-demo-readiness-ci-report
pnpm install --frozen-lockfile
pnpm postgres:start
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm verify
pnpm test:governance
pnpm dev
```

If dashboard port 3000 is busy:

```sh
WEB_PORT=3001 pnpm --filter @agentgate/web-dashboard dev
```

Useful URLs:

- Dashboard: `http://localhost:3000`
- API health: `http://localhost:4000/health`
- Risk scanner: `http://localhost:3000/risk-scanner`
- Live activity: `http://localhost:3000/live`
- Approvals: `http://localhost:3000/approvals`
- Skill runs: `http://localhost:3000/skill-runs`
- Audit list: `http://localhost:3000/audit`

## Demo Script

1. Open `/risk-scanner`.
2. Simulate `safe_tests`, `create_pr`, `merge_main`, `production_deploy`, `production_db_migration`, `research_agent_deploy`, and `mcp_drop_table`.
3. Confirm the scanner says `side_effects.creates_skill_run = false`.
4. Open `/live`.
5. Click Replay Scenario.
6. Show safe actions moving through quickly.
7. Show merge/deploy actions requiring approval.
8. Show production DB migration forced through dry-run evidence first.
9. Open `/approvals`, approve a ready production action with a comment.
10. Open the skill run detail, issue a scoped token if needed, execute, and watch SSE logs.
11. Open `/audit/<trace_id>` and show the complete trace badge.

API calls for the same demo:

```sh
curl http://localhost:4000/health
curl http://localhost:4000/api/v1/demo/actions
curl -X POST http://localhost:4000/api/v1/demo/actions/safe_tests/replay
curl -X POST http://localhost:4000/api/v1/demo/actions/research_agent_deploy/replay
curl -X POST http://localhost:4000/api/v1/demo/actions/production_deploy/replay
curl -X POST http://localhost:4000/api/v1/demo/actions/production_db_migration/replay
curl -X POST http://localhost:4000/api/v1/demo/scenario/replay
curl http://localhost:4000/api/v1/skill-runs/:run_id
curl -N -H 'Accept: text/event-stream' -H 'Last-Event-ID: 2' http://localhost:4000/api/v1/skill-runs/:run_id/logs
curl 'http://localhost:4000/api/v1/audit-integrity?skill_run_id=:run_id'
```

## Recommended Merge Order

1. Merge PR1 into `codex/agentgate-v5-phase-3`.
2. Merge PR2 into PR1 branch.
3. Merge PR3 into PR2 branch.
4. Merge PR4 into PR3 branch.
5. Merge PR5 into PR4 branch.

After the stack lands, merge the resulting top branch into the long-lived target branch using the same order GitHub shows for stacked PRs.
