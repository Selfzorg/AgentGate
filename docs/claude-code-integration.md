# Claude Code Integration

AgentGate can govern Claude Code tool calls locally through a project hook. The hook calls `POST /api/v1/decision` before Claude Code runs `Bash`, `Edit`, `Write`, or `mcp__.*` tools.

## Fresh Setup

```sh
pnpm install
pnpm postgres:start
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API defaults to `http://localhost:4000`.

## Install The Hook

Project-local install:

```sh
node scripts/install-claude-hook.mjs
```

This writes `.claude/settings.json` from `.claude/settings.example.json`. If the file already exists, the installer creates a timestamped backup before writing a merged config. It does not edit `~/.claude/settings.json` unless you explicitly pass `--global`.

Useful options:

```sh
node scripts/install-claude-hook.mjs --dry-run
node scripts/install-claude-hook.mjs --target /path/to/project/.claude/settings.json
node scripts/install-claude-hook.mjs --global
```

## Start Claude Code

For Anthropic-native models, starting Claude from the project root is usually enough:

```sh
claude
```

For DeepSeek or other Claude-compatible provider bridges, use the project launcher:

```sh
pnpm claude:agentgate
```

The launcher starts Claude Code with `--bare`, then explicitly loads `.claude/settings.json`, `.mcp.json`, and `CLAUDE.md`. This avoids provider bridges that reject Claude Code's default extra `system` role messages while keeping the AgentGate hook, MCP proxy, and project instructions active.

## Hook Environment

```sh
export AGENTGATE_API_BASE_URL=http://localhost:4000
export AGENTGATE_TENANT_ID=tenant_demo
export AGENTGATE_WORKSPACE_ID=workspace_demo
export AGENTGATE_AGENT_ID=agent_code_001
export AGENTGATE_AGENT_TYPE=coding_agent
export AGENTGATE_AGENT_ROLE=code_agent
```

Optional debug logging:

```sh
export AGENTGATE_HOOK_DEBUG=1
```

Debug logs are redacted and written to `.agentgate/logs/hook-events.jsonl`.

## Expected Demo Prompts

```text
Run pnpm test
Deploy production with vercel deploy --prod
Run npm run migrate:prod against prod-main
As a research agent, deploy production
Call mcp__github__merge_pr targeting main
Trigger destroy cloud environment resources
```

Expected decisions:

- `pnpm test` maps to `ALLOW`.
- `npm run migrate:prod` maps to `FORCE_DRY_RUN`.
- `vercel deploy --prod` maps to `REQUIRE_APPROVAL`.
- research-agent production deploy maps to `DENY`.
- `mcp__github__merge_pr` normalizes to `mcp.github.merge_pr` and is governed by merge policy.
- Imported or natural-language risky actions should call `mcp__agentgate__agentgate_govern_action` with `raw_action` set to the user's request, letting the registry resolve commands such as `destroy-environment`.

For approval-required results, AgentGate does not expect Claude to guess readiness context. The API resolves policy-required checks to read-only evidence skills and queues `evidence_tasks`. Claude Code can then claim those tasks through the AgentGate MCP proxy, execute read-only evidence checks, and submit results. Critical actions still wait for human approval after evidence is ready when risk requires it.

## Automatic Evidence Worker

The project settings example also installs a `SessionStart` hook:

```json
{
  "type": "command",
  "command": "node .agentgate/hooks/claude-sessionstart-evidence-worker.mjs"
}
```

When Claude Code opens or resumes this project, that hook starts one background worker if it is not already running:

```sh
pnpm evidence:claude-worker
```

The worker polls `/api/v1/evidence-tasks`, claims queued read-only evidence tasks, launches headless Claude Code with read-only tool permissions, submits the evidence JSON result, and writes task lifecycle logs under `.agentgate/logs/`. It sets `AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART=false` for nested Claude runs so it does not recursively start more workers. The project launcher and SessionStart hook default to `AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK=4 AGENTGATE_EVIDENCE_AGENT_CONCURRENCY=4`, so up to four headless Claude evidence checks can run in parallel unless you override those values.

The Claude evidence worker must not run the repository test suite directly. In this local MVP, tests create governance fixtures in the same demo database, so running `pnpm test` from evidence collection can recursively create more evidence tasks. Test evidence should inspect existing logs/metadata or use the deterministic fallback path.

To test once without spending model calls, use the deterministic demo driver:

```sh
AGENTGATE_EVIDENCE_AGENT_DRIVER=demo pnpm evidence:claude-worker --once
AGENTGATE_EVIDENCE_WORKER_CONCURRENCY=4 pnpm evidence:process
```

To disable autostart for a session:

```sh
export AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART=false
```

## Fail Mode

The hook fails closed by default if the AgentGate API is unavailable. You can allow clearly safe read/test commands only:

```sh
export AGENTGATE_HOOK_FAIL_MODE=open
```

In open mode, safe commands such as `pnpm test`, `pnpm lint`, `git status`, `git diff`, `ls`, and `rg` are allowed in observe mode. File writes, MCP calls, production deploys, migrations, and destructive shell commands remain blocked.

## Troubleshooting

- `API Error: 400 ... messages[1].role: unknown variant system`: restart Claude with `pnpm claude:agentgate`. This is a provider-bridge compatibility issue before AgentGate hook execution, not an AgentGate denial.
- `permissionDecision: deny` with `AgentGate API unavailable`: start the API with `pnpm dev` or set `AGENTGATE_API_BASE_URL`.
- `Validation error`: confirm tenant/workspace/agent IDs match seeded fixtures.
- No debug log: set `AGENTGATE_HOOK_DEBUG=1` and run Claude Code from the project root.
- Wrong policy result: include enough context in the command or tool args, such as `environment`, `target_branch`, `database`, or `dry_run_completed`.

## Security Limitations

This is an MVP local integration. It governs Claude Code before tool use and records decisions in PostgreSQL, but it is not a sandbox and does not prevent users from bypassing Claude Code or editing local settings. The hook redacts obvious secret-like values before logging and before sending payloads to AgentGate, but avoid putting production secrets in prompts, commands, or MCP arguments.
