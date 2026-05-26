# Local Postgres

Docker is intentionally not required for this workspace. The Phase 0 local path uses Homebrew Postgres 16 and the helper script at `scripts/local-postgres.sh`.

```sh
pnpm postgres:init
pnpm postgres:start
pnpm postgres:stop
```

The database URL expected by `.env.example` is:

```text
postgresql://agentgate:agentgate@localhost:5432/agentgate?schema=public
```
