# Codex Integration

AgentGate can govern Codex tool calls through the same decision API used by the Claude Code hook. The Codex hook normalizes shell, patch, file mutation, and MCP tool calls into `POST /api/v1/decision` requests before execution.

## Install The Hook

Project-local install:

```sh
pnpm codex:install-hook
```

This writes `.codex/hooks.json` from `.codex/hooks.example.json`. If the file already exists, the installer creates a timestamped backup and merges the AgentGate `PreToolUse` hook. It only edits `~/.codex/hooks.json` when `--global` is passed.

Useful options:

```sh
node scripts/install-codex-hook.mjs --dry-run
node scripts/install-codex-hook.mjs --target /path/to/project/.codex/hooks.json
node scripts/install-codex-hook.mjs --global
```

## Governed Tools

The hook supports these local tool shapes:

- `Bash`, `Shell`, `shell`, and `exec_command` shell executions.
- `apply_patch` and `ApplyPatch` patch operations.
- `Edit` and `Write` file mutation tools.
- `mcp__server__tool` and `mcp.server.tool` MCP tool names.

AgentGate-owned MCP calls such as `mcp__agentgate__agentgate_deploy_production` are allowed through to the AgentGate MCP proxy, where the proxy performs governance and returns the structured tool result. For imported skills or risky natural-language actions that do not have a dedicated tool, use `mcp__agentgate__agentgate_govern_action` with the exact user request in `raw_action`.

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

Codex debug logs are redacted and written to `.agentgate/logs/codex-hook-events.jsonl`. Set `AGENTGATE_CODEX_HOOK_LOG_PATH` to override that path.

## Expected Demo Prompts

```text
Run pnpm test
Apply a small patch
Deploy production with vercel deploy --prod
Run npm run migrate:prod against prod-main
Call mcp__github__merge_pr targeting main
```

Expected decisions:

- `pnpm test` maps to `ALLOW`.
- `apply_patch` is governed as a file mutation action.
- `npm run migrate:prod` maps to `FORCE_DRY_RUN`.
- `vercel deploy --prod` maps to `REQUIRE_APPROVAL`.
- `mcp__github__merge_pr` normalizes to `mcp.github.merge_pr` and is governed by merge policy.

## Fail Mode

The hook fails closed by default if the AgentGate API is unavailable. You can allow clearly safe read/test commands only:

```sh
export AGENTGATE_HOOK_FAIL_MODE=open
```

In open mode, safe commands such as `pnpm test`, `pnpm lint`, `git status`, `git diff`, `ls`, and `rg` are allowed in observe mode. File writes, patch application, MCP calls, production deploys, migrations, and destructive shell commands remain blocked.
