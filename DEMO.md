# AgentGate Judge Demo

This is the safest way to judge AgentGate: run it locally from GitHub, import the committed Claude skills, then let Claude Code trigger governed actions through the AgentGate MCP proxy.

## What This Demo Proves

- A developer can scan real repo-local Claude commands, subagents, and skills without hand-writing YAML.
- AgentGate stores approved imports as versioned registry entries with hashes, source paths, runtimes, policy aliases, and evidence checks.
- Risky actions create persisted runs, evidence tasks, approval packets, scoped execution tokens, logs, and audit events.
- Claude Code can continue an approved imported skill and execute the exact approved skill body.
- Destructive actions can be resolved but remain blocked when required evidence is missing.

## Prerequisites

- Node.js 22 or newer.
- Corepack.
- Homebrew PostgreSQL 16 for the built-in local DB helper, or your own `DATABASE_URL`.
- Claude Code for the live Claude path. Without Claude Code, use the golden CLI scenarios below.

## Five-Minute Setup

```sh
git clone <your-agentgate-repo-url>
cd AgentGate
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install
pnpm demo:bootstrap
pnpm demo:local
```

Open:

- Dashboard: `http://localhost:3001`
- API health: `http://localhost:4000/health`

If port `3001` is busy:

```sh
WEB_PORT=3022 pnpm demo:local
```

## Start Claude Code

In a second terminal from the repo root:

```sh
pnpm claude:agentgate
```

This launcher loads:

- `.claude/settings.json` for the `PreToolUse` hook and evidence-worker session hook.
- `.mcp.json` for the AgentGate MCP server.
- `CLAUDE.md` for the instruction that risky/imported actions must use AgentGate first.

If Claude was already open before `pnpm demo:bootstrap`, restart it so it reloads the MCP tool list.

## Demo Path 1: Import Real Skills

1. Open `http://localhost:3001/skills`.
2. Leave Skill Root empty to scan the repository root.
3. Keep User Scopes off for a deterministic judge demo.
4. Click Scan.
5. Confirm candidates such as:
   - `prod-deployment`
   - `destroy-environment`
   - `db-migration`
   - `ecommerce-ops-agent`
6. Open the candidate detail panel.
7. Inspect source path, hash, declared tools, side-effect classification, inferred checks, and policy aliases.
8. Click Select Pending Candidates.
9. Approve selected skills.

Expected result: the registry list refreshes with imported Claude commands, subagents, and skills. Duplicate or custom evidence warnings are visible instead of silently corrupting registry state.

## Demo Path 2: Simulate Before Enforcement

1. Open `/risk-scanner`.
2. Choose Source: Claude.
3. Use an imported skill such as `prod-deployment`.
4. Click Build Simulation Payload.
5. Click Simulate Policy.

Expected result: AgentGate shows the resolved imported skill, risk, matching policy, required evidence, and decision without creating side effects.

## Demo Path 3: Govern A Production Skill Through Claude

In Claude Code, prompt:

```text
deploy ecommerce checkout to production using prod-deployment
```

Expected result:

- Claude calls AgentGate first.
- AgentGate resolves the imported `prod-deployment` Claude command.
- The run requires evidence and approval.
- The dashboard shows the run under `/approvals` and `/skill-runs/<run_id>`.

To complete demo evidence deterministically:

```sh
pnpm evidence:process
```

Then:

1. Open `/approvals`.
2. Approve the ready packet with a comment.
3. Open the run page.
4. Click Continue in Claude and paste/run the shown command in Claude Code.
5. Claude receives the approved skill body.
6. Claude executes the body and completes the run through AgentGate.

Expected visible side effect for the imported demo skill:

```sh
tail -n 5 ecommerce_operations.log
```

You should see a line like:

```text
This prod-deployment got executed
```

## Demo Path 4: Destructive Action Is Blocked Safely

In Claude Code, prompt:

```text
trigger destroy cloud environment resources
```

Expected result:

- Claude uses `agentgate_govern_action`.
- AgentGate resolves the imported `destroy-environment` command.
- The action is critical risk.
- Evidence includes `management_approval_token`.
- The demo worker marks that custom check as missing because no real management approval connector exists.
- The action cannot be approved/executed until that evidence is supplied by a custom worker or connector.

This is intentional: the demo proves AgentGate does not pretend arbitrary cloud destruction is safe.

## No-Claude Fallback: Golden Scenarios

If Claude Code is unavailable, the DB-backed governance lifecycle can still be demonstrated:

```sh
pnpm demo:run merge_pr_with_agentgate
pnpm demo:run production_deploy_with_agentgate
pnpm demo:run production_db_migration_with_agentgate
pnpm demo:run deny_destructive_action
pnpm demo:run retry_failed_execution
```

Use the printed run IDs and trace IDs to inspect:

- `/skill-runs/<run_id>`
- `/approvals`
- `/audit/<trace_id>`

## Reset Between Takes

```sh
pnpm demo:reset
rm -f ecommerce_operations.log
```

Stop local Postgres when finished:

```sh
pnpm postgres:stop
```

## Verification

Before sharing the repo:

```sh
pnpm verify
```

This runs lint, TypeScript checks, database-isolated migrations/seeding, and the full Vitest suite.

## Troubleshooting

- Empty dashboard: confirm `pnpm demo:local` is running and open `http://localhost:3001`.
- API unreachable: open `http://localhost:4000/health`.
- MCP tool list stale: run `pnpm mcp:build`, then restart Claude Code.
- Skills not found: scan with an empty Skill Root from this repo root, or paste the absolute repo path.
- Evidence stuck on `management_approval_token`: that is a custom evidence key by design. Use `prod-deployment` for a complete happy path, or add a custom worker/connector for that check.
- Port conflict: run `WEB_PORT=3022 pnpm demo:local` and open `http://localhost:3022`.

## Safety Boundary

The governance lifecycle is real and persisted in Postgres. Production deploys, database mutations, Vercel mutations, Kubernetes mutations, and GitHub merges remain simulated unless an imported Claude demo skill is explicitly continued in Claude Code. The committed imported demo skills only append to `ecommerce_operations.log`.
