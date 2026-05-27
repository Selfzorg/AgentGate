# AgentGate

AgentGate is the runtime governance layer for AI agent skills. The MVP now covers fixture-backed policy decisions, approvals, dry-runs, scoped execution tokens, the DB-backed runner loop, SSE execution logs, audit trace integrity, and a read-only risk scanner.

## Quickstart

```sh
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install
cp .env.example .env
pnpm postgres:init
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The local Postgres helper uses Homebrew-installed Postgres and stores local data in `.postgres/`.

Open the dashboard at `http://localhost:3000` and the API at `http://localhost:4000`. If another app already owns port 3000, run the dashboard on another port:

```sh
WEB_PORT=3001 pnpm --filter @agentgate/web-dashboard dev
```

## Verification

```sh
pnpm verify
pnpm test:governance
```

`pnpm verify` runs lint, TypeScript checks, and the full Vitest suite. `pnpm test:governance` focuses the DB-backed Phase 3 and stacked governance hardening tests.

## Demo Flow

1. Open `/risk-scanner` and simulate the fixture-backed actions before creating any runs.
2. Open `/live` and replay the governed demo scenario.
3. Review `/approvals` for approval-required actions and dry-run evidence.
4. Open a skill run detail page to issue/inspect token status, queue execution, and stream persisted logs.
5. Open `/audit/<trace_id>` to verify complete or incomplete lifecycle traces.

The MVP simulates production mutations while persisting the governance lifecycle in Postgres.
