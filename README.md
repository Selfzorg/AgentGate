# AgentGate

AgentGate is the runtime governance layer for AI agent skills. The MVP now covers imported Claude/Codex/MCP skill discovery, review snapshots, evidence-backed approvals, policy simulation, scoped execution tokens, Claude handoff completion, the DB-backed runner loop, SSE execution logs, and audit trace integrity.

## Judge Demo Quickstart

For the shortest local demo from a fresh clone:

```sh
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm demo:bootstrap
pnpm demo:local
```

`pnpm demo:local` starts the API, dashboard, and the best available evidence worker: `codex_cli` when `codex` is on PATH, then `claude_code_mcp` when `claude` is on PATH, otherwise `local_deterministic`. Override it with `pnpm demo:local -- --evidence-runtime codex|claude|local|none`.

Then open `http://localhost:3001`. In another terminal, confirm the app is ready:

```sh
pnpm demo:verify
```

In a second terminal, start Claude Code with the AgentGate project hook, MCP proxy, and project instructions:

```sh
pnpm claude:agentgate
```

See [DEMO.md](./DEMO.md) for the judge script, expected prompts, fallbacks, and troubleshooting.

## Developer Quickstart

```sh
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm demo:bootstrap
pnpm dev
```

The local Postgres helper first uses native PostgreSQL CLI tools and stores local data in `.postgres/`.
It auto-detects Homebrew paths on macOS and standard PostgreSQL installer paths on Windows. If Postgres is installed somewhere else, set `POSTGRES_BIN_DIR` to its `bin` directory. If no local PostgreSQL CLI tools are available, the helper falls back to Docker with `postgres:16-alpine`, then to embedded PGlite stored in `.pglite/`.
`pnpm demo:bootstrap` installs workspace dependencies when they are missing, creates `.env`, prepares the database, applies migrations, seeds deterministic demo data, and builds the MCP proxy.

Open the dashboard at `http://localhost:3000` and the API at `http://localhost:4000`. If another app already owns port 3000, run the dashboard on another port:

```sh
pnpm --filter @agentgate/web-dashboard dev -- --port 3001
```

## Verification

```sh
pnpm verify
pnpm test:governance
```

`pnpm verify` runs lint, TypeScript checks, and the full Vitest suite. `pnpm test:governance` focuses the DB-backed Phase 3 and stacked governance hardening tests.
Use native PostgreSQL or Docker Postgres for the full test suite; embedded PGlite is only the no-install demo fallback.

## Demo Flow

Reset data at any time with `pnpm demo:reset`. With `pnpm dev` running, execute a golden scenario from the terminal:

```sh
pnpm demo:run merge_pr_with_agentgate
pnpm demo:run production_deploy_with_agentgate
pnpm demo:run production_db_migration_with_agentgate
pnpm demo:run deny_destructive_action
pnpm demo:run retry_failed_execution
```

1. Open `/live` and compare the journey rail: without AgentGate, observe mode, and enforce mode.
2. Replay fixture-backed actions or run a golden scenario.
3. Open `/skills`, scan the repository or a downloaded skill root, create a review snapshot, edit inferred evidence, and approve selected skills into the registry.
4. Use `/risk-scanner` to build a simulation payload from an imported skill and preview policy before enforcement.
5. Review `/approvals` for approval-required actions and dry-run evidence.
6. From an approved packet, choose Continue Execution to open the run page. Imported Claude skills use Continue in Claude; connector paths use scoped token plus Execute Through AgentGate.
7. Open `/audit/<trace_id>` to verify complete or incomplete lifecycle traces.

The MVP simulates production mutations while persisting the governance lifecycle in Postgres.

Approval evidence is collected through asynchronous read-only evidence tasks resolved from the skill registry. Claude/Codex workers can claim and submit those tasks, while `pnpm demo:local` auto-selects an evidence worker at startup: Codex first, Claude second, deterministic local fallback last. If you are not using `demo:local`, run `pnpm evidence:claude-worker` for an agent worker, `pnpm evidence:worker` for a continuously heartbeating deterministic worker, or `pnpm evidence:process` to process queued evidence once. Target deploy, merge, and database mutation skills are not executed during evidence collection. The deterministic worker processes tasks in parallel by default with `AGENTGATE_EVIDENCE_WORKER_CONCURRENCY=4`.

For automatic Claude evidence collection, run `pnpm evidence:claude-worker`. The project Claude `SessionStart` hook can start this worker when Claude Code opens; set `AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART=false` to opt out. The `pnpm claude:agentgate` launcher gives the project worker parallel defaults: `AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK=4` and `AGENTGATE_EVIDENCE_AGENT_CONCURRENCY=4`.

When using Claude Code through DeepSeek or another provider bridge, start it with the project-safe launcher:

```sh
pnpm claude:agentgate
```

This uses Claude Code bare mode plus explicit AgentGate settings/MCP/project instructions, avoiding provider errors about unsupported `system` role messages.
