# Codex Task Prompts

## Phase 0

Create AgentGate Phase 0: monorepo foundation and complete Prisma schema baseline.

Before creating product APIs or UI, create `prisma/schema.prisma` using the v5 schema relations, indexes, and uniqueness rules.

Build:

- pnpm workspace monorepo
- `apps/web-dashboard` with Next.js App Router
- `apps/api-server` with Fastify
- `apps/runner-worker` with TypeScript entrypoint
- core packages under `packages/`
- complete `prisma/schema.prisma`
- `prisma/seed.ts` loading deterministic demo fixtures
- local Postgres helper
- configs for demo agents, skills, policies, actions, and gate checks
- `AGENTS.md` with project rules

Do not implement product logic yet.

Done when:

- `pnpm install` works
- `pnpm lint` works
- `pnpm typecheck` works
- `pnpm test` works
- `pnpm db:migrate` works
- `pnpm db:seed` works
- `pnpm dev` starts placeholder dashboard/API/internal runner loop
