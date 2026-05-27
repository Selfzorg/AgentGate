# Overnight Stack Summary

## PR Order

| Order | Branch | Target | PR URL | Status |
| --- | --- | --- | --- | --- |
| 1 | `feature/01-governance-test-harness` | `codex/agentgate-v5-phase-3` | https://github.com/Selfzorg/AgentGate/pull/3 | Draft open, mergeable |
| 2 | `feature/02-policy-simulation-risk-scanner` | `feature/01-governance-test-harness` | https://github.com/Selfzorg/AgentGate/pull/4 | Draft open, mergeable |
| 3 | `feature/03-audit-integrity-hardening` | `feature/02-policy-simulation-risk-scanner` | https://github.com/Selfzorg/AgentGate/pull/5 | Draft open, mergeable |
| 4 | `feature/04-runner-failure-retry-idempotency-hardening` | `feature/03-audit-integrity-hardening` | https://github.com/Selfzorg/AgentGate/pull/6 | Draft open, mergeable |
| 5 | `feature/05-demo-readiness-ci-report` | `feature/04-runner-failure-retry-idempotency-hardening` | https://github.com/Selfzorg/AgentGate/pull/7 | Draft open, mergeable |

PR1 through PR4 are one-commit PRs stacked on the previous branch. PR5 is documentation/readiness focused and now contains two docs commits: the original readiness report plus the home-testing handoff. Live GitHub PR metadata confirmed the target branches above.

## PR Description QA

| PR | Summary | Test plan | Changed files | Risks / notes | UI screenshots or notes |
| --- | --- | --- | --- | --- | --- |
| PR1 | Present | Present | Present | Present | No UI change |
| PR2 | Present | Present | Present | Present | Browser smoke note for `/risk-scanner` |
| PR3 | Present | Present | Present | Present | Browser smoke note for `/audit/<traceId>` |
| PR4 | Present | Present | Present | Present | No UI change |
| PR5 | Present | Present | Present | Present | No UI files changed; note included |

## Tests Run

| Scope | Commands | Result |
| --- | --- | --- |
| PR1 branch | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 4 files / 25 tests |
| PR2 branch | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 5 files / 28 tests |
| PR3 branch | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 6 files / 31 tests |
| PR4 branch | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test` | Pass, 7 files / 34 tests |
| PR5 branch | `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm test:governance` | Pass, full 7 files / 34 tests; governance 4 files / 21 tests |
| Integration branch | `pnpm db:generate`; `pnpm db:migrate`; `pnpm db:seed`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm test:governance`; `pnpm verify` | Pass |
| HTTP API smoke | Local API on port 4101 plus demo/action/scenario/log/audit calls | Pass |

## Integration Branch Result

Temporary local branch: `codex/home-release-qa-final-20260527`

Merge order:

```sh
git merge --no-ff --no-edit feature/01-governance-test-harness
git merge --no-ff --no-edit feature/02-policy-simulation-risk-scanner
git merge --no-ff --no-edit feature/03-audit-integrity-hardening
git merge --no-ff --no-edit feature/04-runner-failure-retry-idempotency-hardening
git merge --no-ff --no-edit feature/05-demo-readiness-ci-report
```

Result: clean local integration merge, no conflicts, no push to `main`.

## Demo Path QA

- `GET /api/v1/demo/actions` returned the same seven IDs as `configs/demo-actions.yaml`.
- Replays returned all four decisions: `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, `FORCE_DRY_RUN`.
- `POST /api/v1/demo/scenario/replay` exercised approvals, dry-run, token issuance, queueing, runner processing, persisted logs, and audit events.
- The scenario endpoint and internal runner loop completed the queued scenario rows; the exact claimed count can vary because the API starts the runner loop during dev.
- Production deploy status ended as `completed`.
- SSE logs included `execution_log` and `execution_completed` events from persisted `execution_logs`.
- `GET /api/v1/audit-integrity?skill_run_id=:run_id` returned `complete: true`.
- Token detail responses exposed only metadata fields, not raw tokens or hashes.

## Files Changed By Area

- PR1: `tests/phase3.test.ts`, `docs/testing-governance-scenarios.md`.
- PR2: risk scanner API/service/UI, shared request schema, gate-check preview, policy precedence, risk scanner tests, deterministic SSE test fix.
- PR3: audit integrity service/API/UI/client types/tests.
- PR4: retry route, token validation/reissue logic, by-run runner helper, runner hardening tests, test isolation updates.
- PR5: `README.md`, `docs/demo-script.md`, `package.json`, `DEMO_READINESS_REPORT.md`, `HOME_TESTING_HANDOFF.md`, this summary.

## Bugs Found And Fixes Made

- No product code bugs found.
- PR5 description metadata was corrected on GitHub to include Test Plan, Changed Files, and Risks / Notes.
- Local tooling notes: `gh` is not installed; Prisma migrate needed local Postgres access outside the sandbox; the first HTTP probe used an invalid empty JSON request body and was rerun with `{}`.

## Regression Search

- Raw token exposure: no browser/API exposure found; hashes appear in schema/storage and tests that assert non-exposure.
- Hardcoded demo actions in UI: React launcher loads actions from API, not independent fixture IDs.
- Redis/BullMQ/Kafka/NATS: no dependency found.
- Frontend-only fake execution: not found; execution state is DB-backed.
- Real production mutation: not found; demo connectors simulate deployment/database/GitHub side effects.
- Audit completeness: covered by tests and HTTP audit-integrity smoke.

## Risks And Blockers

- No current release blocker.
- Local Postgres must be running and seeded for DB-backed tests.
- Port 3000 may be occupied; use `WEB_PORT=3001` for the dashboard.
- No GitHub Actions workflow was added because the repo had no existing `.github/workflows` directory.
- Production, Vercel, Kubernetes, database mutation, and GitHub merge side effects remain simulated by PRD design.

## Home Steps

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

If port 3000 is busy:

```sh
WEB_PORT=3001 pnpm --filter @agentgate/web-dashboard dev
```

## Demo API Calls

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

## Merge Order

1. `feature/01-governance-test-harness`
2. `feature/02-policy-simulation-risk-scanner`
3. `feature/03-audit-integrity-hardening`
4. `feature/04-runner-failure-retry-idempotency-hardening`
5. `feature/05-demo-readiness-ci-report`
