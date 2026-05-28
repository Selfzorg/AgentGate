# AI Run Intelligence Report

## Status

AI Run Intelligence is implemented as an optional, advisory layer on top of deterministic AgentGate governance. It does not change skill resolution, risk scoring, policy decisions, gate checks, approval state transitions, token issuance, runner behavior, execution logs, or audit events.

## Architecture

- `packages/ai-provider` owns provider configuration, provider abstraction, strict output schema parsing, token/cost estimation, and redaction utilities.
- `apps/api-server/src/services/ai-run-analysis-service.ts` owns evidence collection, payload shaping, budget checks, provider invocation, malformed-output handling, and `AiRunAnalysis` persistence.
- `apps/api-server/src/routes/ai-analysis.routes.ts` exposes advisory generation and retrieval endpoints.
- `apps/web-dashboard/components/ai/AiInsightsEngine.tsx` adds one compact sidebar card on `/skill-runs/:runId`.

The provider interface is swappable through `AiProvider` and `createAiProvider(config)`. The default implementation uses OpenAI-compatible chat completions for `openai` and `deepseek`, while tests inject a mock provider.

## Prisma Migration

Migration created and applied:

```sh
pnpm exec prisma migrate dev --name add_ai_run_intelligence
```

Created migration:

```txt
prisma/migrations/20260527073128_add_ai_run_intelligence/migration.sql
```

Schema changes:

- Added `AiRunAnalysisStatus` enum: `completed`, `failed`, `disabled`.
- Added `AiRunAnalysis` model mapped to `ai_run_analyses`.
- Added explicit one-to-one `SkillRun.aiRunAnalysis` relation through unique `skillRunId`.
- Added `onDelete: Cascade` from `AiRunAnalysis.skillRun` to `SkillRun`.
- Added indexes for `traceId`, tenant/workspace/createdAt, and status/createdAt.

No raw-token column was added. Execution tokens still store only `tokenHash`.

## Env Vars

```sh
AI_ENABLED="false"
AI_PROVIDER="openai"
AI_MODEL="gpt-4o-mini"
AI_API_KEY=""
AI_MAX_INPUT_TOKENS="4000"
AI_DAILY_BUDGET_CENTS="50"
```

AI calls are disabled unless `AI_ENABLED=true`.

## Endpoints

- `POST /api/v1/skill-runs/:run_id/ai-analysis`
- `GET /api/v1/skill-runs/:run_id/ai-analysis`
- `POST /api/v1/audit/:trace_id/ai-summary`

`GET /api/v1/skill-runs/:run_id` also returns `ai_analysis` when one exists.

## UI Placement

The run detail page now renders a single card titled `AI Insights Engine` beside the existing `Execution Console`:

```txt
/skill-runs/:runId
  main: Execution Console
  sidebar: AI Insights Engine
```

The card uses compact tabs for Summary, Approval, and Failure views. It does not add extra pages or broad dashboard panels.

## Redaction Strategy

Before a model call, the service compiles persisted run context, audit events, gate checks, approval packet, dry-run result, execution logs, token status metadata, attempts, and final status.

The payload is redacted before provider invocation:

- Transient active execution token strings are extracted from the target `SkillRun.context` and replaced with `[REDACTED_AGENTGATE_TOKEN]`.
- `Authorization: Bearer ...` and bearer tokens are replaced.
- `exec_tok_...` token IDs are replaced.
- 64-character token hashes are replaced.
- API keys, passwords, secrets, bearer tokens, and common env-secret patterns are replaced.
- Browser/model payloads receive token status metadata only, not token IDs or raw token values.

Long execution logs are locally summarized before provider calls. The model receives bounded log context, not unbounded raw logs.

## Cost Controls

- AI is disabled by default.
- `AI_MAX_INPUT_TOKENS` caps model input payload size.
- Long logs are locally summarized before calls.
- `AI_DAILY_BUDGET_CENTS` prevents calls that would exceed the daily stored-cost budget.
- Estimated token and cost metadata is persisted on each analysis.
- Failed and disabled analyses persist with zero provider cost.

## Failure Behavior

Provider errors and malformed JSON are stored as `failed` analyses. They never throw through approval, execution, audit, or dashboard flows.

AI output is validated against a strict schema:

```json
{
  "summary": "string",
  "severity": "info|low|medium|high|critical",
  "risk_notes": ["string"],
  "missing_evidence": ["string"],
  "suggested_actions": ["string"],
  "failure_cause": "string|null",
  "approver_notes": "string|null"
}
```

## Tests Run

Focused AI suite:

```sh
pnpm test:ai
```

Covered:

- Governance decisions do not depend on LLM output.
- Provider failure does not break approval or audit flows.
- Raw tokens/secrets are redacted before model calls.
- Transient active execution token strings are replaced with `[REDACTED_AGENTGATE_TOKEN]`.
- No raw-token DB column is introduced.
- Malformed model output is rejected and stored as failed analysis.
- Pending approvals receive advisory-only approver notes.
- Failed executions receive failure analysis.
- Disabled AI mode performs no external calls.
- Audit trace summary endpoint is advisory and does not mutate trace events.
- `AiRunAnalysis` cascades with local `SkillRun` deletion.

Full suite:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

## Known Limits

- The built-in provider is OpenAI-compatible and intentionally thin. Production deployments can swap provider implementation behind the same interface.
- Cost estimation is approximate and uses local token estimation when providers do not return usage metadata.
- AI summaries are stored per skill run. The trace endpoint resolves a trace to the latest run in that trace.
- AI output is not used for automated decisions, approvals, dry-runs, tokens, retries, or execution.

## Demo Script

1. Start Postgres and seed:

```sh
pnpm postgres:start
pnpm db:seed
```

2. Run with AI disabled to show safe fallback:

```sh
AI_ENABLED=false pnpm dev
```

3. Open a skill run detail page:

```txt
http://localhost:3000/skill-runs/:runId
```

4. Click `Run` in the `AI Insights Engine` card. The card stores a `disabled` analysis and does not call a provider.

5. To test a real provider, set:

```sh
AI_ENABLED=true
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_API_KEY=<provider key>
AI_MAX_INPUT_TOKENS=4000
AI_DAILY_BUDGET_CENTS=50
pnpm dev
```

6. Replay a pending approval or failed execution, open its skill run detail page, and click `Run` in `AI Insights Engine`.

7. Confirm:

- deterministic decision remains unchanged,
- analysis is advisory,
- token values are not exposed,
- token/cost metadata is recorded,
- approval and failure tabs stay inside the single sidebar card.
