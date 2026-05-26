# Governance Scenario Testing

This document describes the deterministic governance harness added for AgentGate V5 Phase 3.

## Purpose

The harness proves that the MVP governance lifecycle is real and persisted while side effects stay simulated:

- demo actions are loaded from `configs/demo-actions.yaml` through the API;
- the dashboard action launcher consumes API data rather than hardcoding fixture actions;
- policy decisions cover `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, and `FORCE_DRY_RUN`;
- approvals, dry-run evidence, execution tokens, runner attempts, execution logs, and audit events are stored in PostgreSQL;
- the browser/API only receive token status and IDs, never token hashes or raw token material;
- DB-backed execution logs can be resumed over SSE using `Last-Event-ID`.

## Scenario Coverage

| Scenario | Fixture action | Expected decision | Persisted assertions |
| --- | --- | --- | --- |
| Safe action | `safe_tests` | `ALLOW` | `skill_runs.status=policy_evaluated`, no approval, no dry-run, no token, no execution logs, base audit events |
| Denied action | `research_agent_deploy` | `DENY` | `skill_runs.status=denied`, matched deny policy, no approval, no dry-run, no token, no execution logs, base audit events |
| Approval action | `production_deploy` | `REQUIRE_APPROVAL` | pending approval packet, passed gate checks, approval grant, credential issue, execution queue, runner completion |
| Dry-run action | `production_db_migration` | `FORCE_DRY_RUN` then `REQUIRE_APPROVAL` | dry-run result, post-dry-run approval packet, passed DB gate checks, dry-run audit events |
| Token execution | `production_deploy` | approved live execution | hash-only stored token, browser-safe API detail, single queued attempt, used token, completed runner state |
| SSE logs | `production_deploy` | completed execution stream | persisted log replay skips prior IDs and emits final `execution_completed` event |

## How To Run

Run the full verification suite after the database migration and deterministic seed are in place:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

To focus on the Phase 3 and PR1 governance harness:

```sh
pnpm test -- tests/phase3.test.ts
```

## Phase 3 PRD Confirmation

The Phase 3 implementation is covered when the harness and the existing Phase 3 tests pass together. The covered PRD paths are:

- issue execution token after approval;
- store only token hash server-side;
- reject missing, expired, reused, or mismatched execution tokens;
- queue execution by changing `skill_runs.status` to `execution_queued`;
- claim and run queued work through the TypeScript runner loop;
- persist runner attempts and execution logs;
- normalize connector success and failure results;
- expose SSE execution logs with resume support;
- surface dashboard-safe token summaries without raw secrets;
- preserve complete audit traces across decision, approval, dry-run, credential, queue, execution, and finalization events;
- keep Redis, BullMQ, Kafka, real production mutations, and frontend-only fake execution out of the MVP.

If these checks pass, the Phase 3 PRD behavior implemented so far is executable end to end.
