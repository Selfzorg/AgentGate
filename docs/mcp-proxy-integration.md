# MCP Proxy Integration

AgentGate ships a local stdio MCP proxy for Claude Code, Codex, or any MCP client. The proxy exposes governed demo tools and calls AgentGate APIs only. It never calls GitHub, Postgres, Vercel, Kubernetes, or production systems directly.

## Fresh Setup

```sh
pnpm install
pnpm postgres:start
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm mcp:build
```

Start the proxy:

```sh
AGENTGATE_API_BASE_URL=http://localhost:4000 pnpm mcp:start
```

## Claude MCP Install

Project-scoped Claude Code install command:

```sh
pnpm mcp:build
claude mcp add --scope project agentgate \
  -e AGENTGATE_API_BASE_URL=http://localhost:4000 \
  -e AGENTGATE_TENANT_ID=tenant_demo \
  -e AGENTGATE_WORKSPACE_ID=workspace_demo \
  -- pnpm mcp:start
```

Use `.mcp.example.json` as the project-local MCP config:

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "pnpm",
      "args": ["mcp:start"],
      "env": {
        "AGENTGATE_API_BASE_URL": "http://localhost:4000"
      }
    }
  }
}
```

Copy or merge it into the MCP config location your Claude Code install uses. AgentGate does not mutate global Claude settings by default.

## Codex MCP Config Example

See `.codex/config.example.toml`:

```toml
[mcp_servers.agentgate]
command = "pnpm"
args = ["mcp:start"]

[mcp_servers.agentgate.env]
AGENTGATE_API_BASE_URL = "http://localhost:4000"
```

## Tools

- `agentgate_run_tests`
- `agentgate_create_pr`
- `agentgate_merge_pr`
- `agentgate_apply_migration`
- `agentgate_drop_table`
- `agentgate_deploy_staging`
- `agentgate_deploy_production`
- `agentgate_replay_demo_action`
- `agentgate_get_run`
- `agentgate_get_audit_trace`
- `agentgate_execute_approved_run`
- `agentgate_list_evidence_tasks`
- `agentgate_claim_evidence_task`
- `agentgate_get_evidence_task`
- `agentgate_submit_evidence_result`
- `agentgate_fail_evidence_task`

## Evidence Task Workflow

Approval-required decisions create asynchronous evidence tasks instead of asking the MCP caller to guess readiness context. A Claude Code or Codex MCP client can act as the evidence worker:

1. Call `agentgate_list_evidence_tasks` with an optional `skill_run_id`.
2. Claim one task with `agentgate_claim_evidence_task` using `runtime=claude_code_mcp` or `runtime=codex_mcp`.
3. Read the task input with `agentgate_get_evidence_task`; it includes the evidence skill, check key, read-only instruction, allowed actions, and forbidden side effects.
4. Execute the read-only evidence skill locally or through the agent's own skill registry.
5. Submit `passed`, `failed`, or `missing` with `agentgate_submit_evidence_result`, or use `agentgate_fail_evidence_task` if the worker itself failed.

## Approved Run Continuation

After all evidence gates pass and a human approves the packet, an MCP client can call `agentgate_execute_approved_run` with the original `run_id`. The tool asks AgentGate to issue a scoped execution token, queues the approved run, and returns the local logs URL. This still does not call real GitHub, databases, Vercel, Kubernetes, or production systems.

For local demo fallback, process queued tasks deterministically:

```sh
pnpm evidence:process
AGENTGATE_EVIDENCE_WORKER_SKILL_RUN_ID=run_123 pnpm evidence:process
AGENTGATE_EVIDENCE_WORKER_CONCURRENCY=4 pnpm evidence:process
pnpm evidence:worker
```

For automatic agent evidence collection, run the Claude evidence worker:

```sh
pnpm evidence:claude-worker
AGENTGATE_EVIDENCE_WORKER_SKILL_RUN_ID=run_123 pnpm evidence:claude-worker --once
```

The worker polls AgentGate, claims queued tasks with `runtime=claude_code_mcp`, launches headless Claude Code with read-only tool permissions, submits the JSON evidence result, heartbeats while work is running, and fails the task with a stored reason if the agent command errors or times out. It defaults to one agent task at a time; raise both `AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK` and `AGENTGATE_EVIDENCE_AGENT_CONCURRENCY` to opt into parallel Claude/Codex evidence subprocesses.

Useful worker environment variables:

- `AGENTGATE_EVIDENCE_AGENT_DRIVER=claude|codex|demo`
- `AGENTGATE_EVIDENCE_AGENT_RUNTIME=claude_code_mcp|codex_mcp|claude_cli|codex_cli`
- `AGENTGATE_EVIDENCE_WORKER_AGENT_ID=claude_code_evidence_worker`
- `AGENTGATE_EVIDENCE_WORKER_CONCURRENCY=4` for deterministic local processing
- `AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK=4`
- `AGENTGATE_EVIDENCE_AGENT_CONCURRENCY=4`
- `AGENTGATE_EVIDENCE_AGENT_TIMEOUT_MS=120000`
- `AGENTGATE_EVIDENCE_AGENT_COMMAND="claude --print --output-format json"`
- `AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART=false` to disable project SessionStart autostart

The project Claude settings example includes a `SessionStart` hook that starts this worker once per project when Claude Code opens. It writes a PID file under `.agentgate/run/` and logs under `.agentgate/logs/`.

The approval card stays in `collecting` while tasks are queued, claimed, or running. It becomes `ready` only when all gate checks pass; otherwise it becomes `blocked` and shows each failed evidence reason. The per-check Retry button creates a new task for that check.

## Expected Demo Prompts

```text
Use AgentGate to run tests.
Use AgentGate to merge PR 123 into main.
Use AgentGate to apply a production migration to prod-main.
Use AgentGate to drop the users table in production.
Use AgentGate to deploy checkout-api to production.
Replay the production_db_migration demo action through AgentGate.
Fetch the AgentGate run and audit trace for the last blocked call.
```

Expected behavior:

- `agentgate_run_tests` returns `ALLOW` success.
- `agentgate_drop_table` returns `DENY` with `isError: true`.
- `agentgate_deploy_production` returns `REQUIRE_APPROVAL` with run and trace IDs.
- `agentgate_execute_approved_run` succeeds only after the approval packet is approved.
- `agentgate_apply_migration` returns `FORCE_DRY_RUN` until dry-run evidence is provided.

For approval-required calls, AgentGate resolves required evidence checks to read-only evidence skills in the skill registry. The default runtime order prefers external agent runtimes, then deterministic local fallback, then simulated native connector support. Evidence collection records the selected runtime, evidence skill ID, task ID, attempt, and failure reason on each gate check.

## Troubleshooting

- `AgentGate API returned HTTP`: confirm `pnpm dev` is running and `AGENTGATE_API_BASE_URL` points at the API server.
- `Cannot find module`: run `pnpm install` and `pnpm mcp:build`.
- Empty tools list in the client: confirm the MCP config command runs from this repository root.
- Unexpected `ALLOW`: inspect the response JSON for `agentgate.skill_id`, `agentgate.reason`, and the supplied environment/context.
- Approval stays collecting: run `agentgate_list_evidence_tasks` or `pnpm evidence:process` to complete queued evidence.
- Approval stays blocked: open `/approvals`, inspect the failed gate check reason, then use the per-check Retry button after fixing or changing the evidence source.

## Security Limitations

The proxy is a local governance adapter, not a production execution engine. It intentionally simulates side effects by routing tool calls to AgentGate decision endpoints. Secrets and execution token-like values are redacted from MCP output, but clients should still avoid passing raw credentials in tool arguments.
