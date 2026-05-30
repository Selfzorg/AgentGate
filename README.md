# AgentGate

AgentGate is the runtime governance layer for AI agent skills. The MVP now covers imported Claude/Codex/MCP skill discovery, review snapshots, evidence-backed approvals, policy simulation, scoped execution tokens, Claude handoff completion, the DB-backed runner loop, SSE execution logs, and audit trace integrity.

## Judge Demo Quickstart

For the shortest local demo from a fresh clone:

```sh
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install
pnpm demo:bootstrap
pnpm demo:local
```

Then open `http://localhost:3001`. In a second terminal, start Claude Code with the AgentGate project hook, MCP proxy, and project instructions:

```sh
pnpm claude:agentgate
```

See [DEMO.md](./DEMO.md) for the judge script, expected prompts, fallbacks, and troubleshooting.

## Developer Quickstart

```sh
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install
cp .env.example .env
pnpm postgres:init
pnpm demo:setup
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

Approval evidence is collected through asynchronous read-only evidence tasks resolved from the skill registry. Claude/Codex MCP workers can claim and submit those tasks, while `pnpm evidence:process` provides deterministic local fallback for demos and tests; target deploy, merge, and database mutation skills are not executed during evidence collection. The deterministic worker processes tasks in parallel by default with `AGENTGATE_EVIDENCE_WORKER_CONCURRENCY=4`.

For automatic Claude evidence collection, run `pnpm evidence:claude-worker`. The project Claude `SessionStart` hook can start this worker when Claude Code opens; set `AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART=false` to opt out. The `pnpm claude:agentgate` launcher gives the project worker parallel defaults: `AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK=4` and `AGENTGATE_EVIDENCE_AGENT_CONCURRENCY=4`.

When using Claude Code through DeepSeek or another provider bridge, start it with the project-safe launcher:

```sh
pnpm claude:agentgate
```

This uses Claude Code bare mode plus explicit AgentGate settings/MCP/project instructions, avoiding provider errors about unsupported `system` role messages.
