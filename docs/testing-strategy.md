# Testing Strategy

Phase 0 validates repository integrity:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:migrate`
- `pnpm db:seed`

Later phases add unit, database, API integration, UI smoke, and end-to-end scenario tests for the governance lifecycle.
