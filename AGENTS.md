# AgentGate Codex Rules

## Phase Order

1. Create the monorepo skeleton.
2. Create `prisma/schema.prisma` with all relations, indexes, uniqueness rules, and deletion behavior before product logic.
3. Create `prisma/seed.ts` using deterministic demo fixtures.
4. Run the migration locally.
5. Only then implement core packages, API routes, runner behavior, and UI.

## Single-Process MVP Runtime

The MVP runs the Fastify API server and TypeScript runner loop inside one Node.js runtime during `pnpm dev`. The runner may live under `apps/runner-worker`, but the API server imports and starts it as an internal loop.

PostgreSQL is the source of truth for queue state, token state, attempts, logs, audit events, and dashboard state. Redis, BullMQ, Kafka, NATS, and process-shared memory are out of scope for the MVP.

## DB-Backed Queue Rule

Execution work is coordinated with database state transitions:

1. Approval is granted.
2. Execution token is issued.
3. `skill_runs.status` becomes `execution_queued`.
4. The runner loop claims queued rows atomically.
5. The runner writes `execution_logs`.
6. The runner updates the final `skill_runs.status`.

## Fixtures-To-UI Rule

`configs/demo-actions.yaml` and `configs/demo-policies.yaml` are loaded dynamically by the API and surfaced in the dashboard. The React UI must not independently hardcode demo actions.

## Governance-Real, Side-Effects-Simulated Rule

The MVP may simulate production deployments, database mutation, Vercel mutation, Kubernetes mutation, and GitHub merges. The governance lifecycle must be real: decisions, risk, policy, gate checks, approvals, dry-run evidence, execution tokens, runner state, logs, and audit events are persisted.

## Verification Rule

Each implementation task ends with:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

If a check fails, fix the implementation before moving to the next task.
