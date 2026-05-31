# Local Postgres

Docker is not required for this workspace. The local helper at `scripts/local-postgres.mjs` prefers PostgreSQL 16 CLI tools and auto-detects Homebrew paths on macOS plus standard PostgreSQL installer paths on Windows.

If those CLI tools are unavailable, the helper falls back to Docker and starts a `postgres:16-alpine` container named `agentgate-postgres`. If Docker is unavailable too, it starts an embedded PGlite socket server stored in `.pglite/`.

```sh
pnpm postgres:init
pnpm postgres:start
pnpm postgres:stop
```

If PostgreSQL is installed somewhere non-standard, set `POSTGRES_BIN_DIR` to the directory containing `initdb`, `pg_ctl`, `createdb`, and `psql`. If you already have a database, put its connection string in `.env` as `DATABASE_URL`.
The embedded PGlite fallback is for local demo startup. Use native PostgreSQL or Docker Postgres for `pnpm verify` and other full-suite checks.

The database URL expected by `.env.example` is:

```text
postgresql://agentgate:agentgate@localhost:5432/agentgate?schema=public
```
