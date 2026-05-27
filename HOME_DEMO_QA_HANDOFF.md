# Home Demo QA Handoff

## Status

AgentGate is demo-ready on branch `feature/07-demo-readiness-qa`, stacked on `feature/06-ai-run-intelligence`.

This pass does not add a new major backend feature. It polishes the existing demo UI, hardens advisory AI/token/governance tests, verifies deterministic end-to-end behavior, and documents the fastest home validation path.

## Fresh Checkout Commands

```sh
git fetch origin
git checkout feature/07-demo-readiness-qa
pnpm install --frozen-lockfile
pnpm postgres:init
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm verify
pnpm test:governance
pnpm test:ai
pnpm test:demo
```

`pnpm postgres:init` initializes the local cluster if needed and starts it. On later runs, `pnpm postgres:start` is enough when the cluster already exists. If Postgres is already running, confirm with:

```sh
psql -p 5432 -d postgres -tAc 'select 1'
```

Run the app:

```sh
AI_ENABLED=false pnpm dev
```

If port 3000 is busy:

```sh
API_PORT=4103 WEB_PORT=3001 NEXT_PUBLIC_API_BASE_URL=http://localhost:4103 AI_ENABLED=false pnpm dev
```

## Environment

Required:

```sh
DATABASE_URL="postgresql://agentgate:agentgate@localhost:5432/agentgate?schema=public"
API_HOST="0.0.0.0"
API_PORT="4000"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
```

AI Insights flags:

```sh
AI_ENABLED="false"
AI_PROVIDER="openai"
AI_MODEL="gpt-4o-mini"
AI_API_KEY=""
AI_MAX_INPUT_TOKENS="4000"
AI_DAILY_BUDGET_CENTS="50"
```

For local demo safety, keep `AI_ENABLED=false`. The AI card still demonstrates disabled-state behavior without making external calls. To test a real provider, set `AI_ENABLED=true`, set a provider-compatible key, and keep `AI_DAILY_BUDGET_CENTS` low.

## Routes To Open

- Live demo: `http://localhost:3000/live`
- Risk scanner: `http://localhost:3000/risk-scanner`
- Approvals: `http://localhost:3000/approvals`
- Skill run detail: `http://localhost:3000/skill-runs/:run_id`
- Audit trace: `http://localhost:3000/audit/:trace_id`
- Skills: `http://localhost:3000/skills`
- Policies: `http://localhost:3000/policies`

Use port `3001` instead of `3000` if using the alternate command above.

## Expected Demo Sequence

1. Open `/live`.
2. Use the Demo Journey rail as the narration path: Action -> Decision -> Approval -> Token -> Logs -> Audit -> AI Insights.
3. Click `Replay Scenario`.
4. Open the production deploy run from the Activity Stream `Run` link.
5. Confirm the skill run page shows run status, decision, risk, token metadata only, persisted logs, and a single `AI Insights Engine` card.
6. Click `Run` in AI Insights with `AI_ENABLED=false`; expected status is `disabled` and no external AI call occurs.
7. Open the audit trace from the run page.
8. Confirm audit completeness is `complete` and the trace shows ordered lifecycle events.
9. Open `/risk-scanner`, select demo samples, and click `Simulate`; expected side effects all remain false.

## Expected Decisions

| Action ID | Expected Decision |
| --- | --- |
| `safe_tests` | `ALLOW` |
| `create_pr` | `ALLOW` |
| `merge_main` | `REQUIRE_APPROVAL` |
| `production_deploy` | `REQUIRE_APPROVAL` |
| `production_db_migration` | `FORCE_DRY_RUN` before dry-run, then `REQUIRE_APPROVAL` |
| `research_agent_deploy` | `DENY` |
| `mcp_drop_table` | `DENY` |

## AI Insights Test

With AI disabled:

1. Open a run detail page.
2. Click `Run` in the `AI Insights Engine` card.
3. Expected: the card stores a `disabled` analysis, shows `Advisory only`, records zero tokens/cost, and does not call a provider.

With AI enabled:

1. Set `AI_ENABLED=true`, `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY`.
2. Keep `AI_DAILY_BUDGET_CENTS` low.
3. Run a production deploy scenario.
4. Click `Run` in the AI card.
5. Expected: one structured analysis is stored. It must never change policy decisions, approvals, token issuance, execution, retry, or audit state.

## Failure Analysis Test

Use the automated test first:

```sh
pnpm test:ai
```

Manual path:

1. Create a production deploy run.
2. Approve it.
3. Set its context/raw action to simulate failure, or use the tested failure path in `tests/ai-run-intelligence.test.ts`.
4. Execute through the runner.
5. Generate AI analysis.
6. Expected: AI mode is `failure_analysis`, likely cause is advisory only, and the failed execution/audit records remain deterministic.

## SSE Logs Test

After a completed run:

```sh
curl -N -H 'Accept: text/event-stream' -H 'Last-Event-ID: 2' \
  http://localhost:4000/api/v1/skill-runs/:run_id/logs
```

Expected:

- Response starts after sequence `2`.
- Includes `event: execution_log`.
- Includes `event: execution_completed`.
- Does not expose `tokenHash`, `token_hash`, or raw token material.

## Audit Completeness Test

```sh
curl 'http://localhost:4000/api/v1/audit-integrity?skill_run_id=:run_id'
```

Expected:

- `complete: true` for completed approved executions.
- Missing lifecycle events are reported for intentionally incomplete traces.
- Sequence issues are reported if audit event ordering is damaged.

## Commands Run In This QA Pass

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass, lockfile already up to date |
| `pnpm db:generate` | Pass |
| `pnpm db:migrate` | Pass, already in sync |
| `pnpm db:seed` | Pass, seeded 3 users, 3 agents, 8 skills, 8 policies |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm exec vitest run tests/ai-run-intelligence.test.ts tests/demo-readiness-qa.test.ts` | Pass, 15 tests |
| `pnpm verify` | Pass, 9 files / 49 tests |
| `pnpm test:governance` | Pass, 4 files / 21 tests |
| `pnpm test:ai` | Pass, 1 file / 10 tests |
| `pnpm test:demo` | Pass, 17 tests |
| Browser QA on `http://localhost:3001` | Pass |

`pnpm test:demo` and `pnpm test:ai` initially showed sandbox-only Postgres access failures when run plainly. The same commands passed with local DB access, and `pnpm verify` passed with direct Postgres access.

## Browser QA Evidence

Validated with the in-app browser:

- `/live`: Demo Journey rail rendered; Activity Stream loaded persisted decisions; run and audit links present; console clean.
- `/risk-scanner`: samples loaded from API; simulation rendered preview, decision badge, risk badge, checks, and side-effect evidence; console clean.
- `/skill-runs/run_3e444af6e6fc4f6694da`: Execution Console and single AI Insights card rendered; token metadata only; no raw token/hash text found; console clean.
- `/audit/trc_282c93029def4d7bb091`: audit completeness badge rendered; ordered lifecycle evidence present; no raw token/hash text found; console clean.
- `/approvals`, `/skills`, `/policies`: pages loaded from API without console errors.

## UI Improvements Made

- Added a compact Demo Journey rail to `/live`.
- Added shared status badges for decision, risk, run, token, audit, AI, approval readiness, and gate checks.
- Added direct run links from Live Activity and approval packets.
- Improved empty/loading/error states for demo actions, risk scanner samples, skills, and policies.
- Kept AI Insights as one sidebar card on `/skill-runs/:id`.
- Made token handling explicit in the Execution Console: browser sees token ID/status metadata only, never raw token material.
- Improved audit trace summary tiles and token/attempt evidence readability.

## Tests Added Or Hardened

- Added `tests/demo-readiness-qa.test.ts`.
- Added `pnpm test:demo`.
- Hardened AI analysis redaction tests so stored model output is scrubbed, not just provider input.
- Added tests for:
  - AI provider failure not breaking run, approval, and audit APIs.
  - Approval cannot bypass missing required checks.
  - UI-facing run/log/audit/AI responses do not expose raw token material or hashes.
  - Demo UI stays wired to fixture/API data and keeps one AI Insights card.
  - No Redis, BullMQ, Kafka, NATS, RabbitMQ, or frontend-only fake execution dependency/path was introduced.

## Files Changed

- `apps/api-server/src/services/ai-run-analysis-service.ts`
- `apps/web-dashboard/app/live/page.tsx`
- `apps/web-dashboard/components/ai/AiInsightsEngine.tsx`
- `apps/web-dashboard/components/approvals/ApprovalCard.tsx`
- `apps/web-dashboard/components/audit/AuditTimeline.tsx`
- `apps/web-dashboard/components/demo/DemoActionLauncher.tsx`
- `apps/web-dashboard/components/demo/DemoJourneyRail.tsx`
- `apps/web-dashboard/components/execution/ExecutionConsole.tsx`
- `apps/web-dashboard/components/live/LiveActivityTable.tsx`
- `apps/web-dashboard/components/policies/PolicyViewer.tsx`
- `apps/web-dashboard/components/risk-scanner/RiskScannerPanel.tsx`
- `apps/web-dashboard/components/skills/SkillsRegistry.tsx`
- `apps/web-dashboard/components/ui/status-badge.tsx`
- `package.json`
- `tests/ai-run-intelligence.test.ts`
- `tests/demo-readiness-qa.test.ts`
- `OVERNIGHT_STACK_SUMMARY.md`
- `HOME_DEMO_QA_HANDOFF.md`

## Demo Reliability Checks

- No Redis, BullMQ, Kafka, NATS, or RabbitMQ dependency introduced.
- No frontend-only fake execution path introduced.
- No real production deployment, database mutation, Vercel mutation, Kubernetes mutation, or GitHub merge is executed.
- Prisma migration and generated client were verified in sync with `pnpm db:migrate`.
- Demo actions load from `configs/demo-actions.yaml` through API routes.
- Deterministic decisions remain authoritative over all AI output.

## Known Limitations

- The MVP is intentionally single-process for dev: Fastify starts the internal runner loop during `pnpm dev`.
- AI Insights is advisory only and disabled by default.
- Production-impacting side effects are simulated by PRD design.
- The app has no committed Playwright e2e suite; browser QA was manual/automated through the in-app browser.
- Local Postgres must be reachable from the process running Prisma tests.

## Remaining Risks

- Long-running `pnpm dev` can process queued demo rows while tests are running. Stop the dev server before `pnpm test`.
- AI provider behavior varies by vendor; schema validation and redaction are defensive, but keep the budget low and review provider output.
- Port `3000` may be occupied; use the alternate port command if needed.

## Recommended Merge Order

1. `feature/01-governance-test-harness`
2. `feature/02-policy-simulation-risk-scanner`
3. `feature/03-audit-integrity-hardening`
4. `feature/04-runner-failure-retry-idempotency-hardening`
5. `feature/05-demo-readiness-ci-report`
6. `feature/06-ai-run-intelligence`
7. `feature/07-demo-readiness-qa`
