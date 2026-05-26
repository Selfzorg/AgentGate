# AgentGate

AgentGate is the runtime governance layer for AI agent skills. Phase 0 creates the schema-first TypeScript monorepo foundation for the MVP described in the v5 PRD.

## Local Development

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

## Phase 0 Scope

Phase 0 intentionally includes placeholder apps, route modules, package entrypoints, fixtures, Prisma schema, migration readiness, and seed data. Decision logic, approval workflow, dry-run execution, SSE logs, and the runner state machine start in later phases.
