# Production Readiness

AgentGate MVP side effects remain simulated, but production-shaped controls are now explicit:

- Production mutations must execute through an AgentGate runner or connector path.
- Runner-side controls revalidate connector environment allow lists and scoped execution credentials.
- Raw bearer tokens are returned only on request, stored only as hashes, and never required by dashboard views.
- Break-glass requests are audit-only records; they do not grant production authority.
- Audit artifacts can carry stable payload checksums so tampering is visible during review.

## Connector Controls

Live connectors must define:

- allowed environments;
- required scopes;
- credential source;
- timeout and partial-failure behavior;
- rollback or compensating-action expectations.

The MVP runner enforces the first two controls before calling a connector. If a production run is manually queued without a used AgentGate token, the runner fails it before side effects.

## Break Glass

Break-glass is intentionally not an execution bypass. `POST /api/v1/break-glass` requires a non-empty reason and writes a `break_glass.requested` audit event with severity, actor, reason, and `production_authority_granted: false`.

## Enterprise Hook Deployment

Local hooks improve developer experience, but they are not the security boundary. Production systems should only accept:

- AgentGate connector calls;
- short-lived AgentGate-issued credentials bound to run, approval, skill, scope, environment, and expiry.

Organizations should deploy Claude/Codex hooks through managed dotfiles or device management, and should treat hook removal as a signal for review rather than as proof of safety.

## Threat Model Summary

- Developer bypasses hooks: production authority still requires connector/token path.
- Agent changes action after approval: execution envelope and token scopes bind run, skill, environment, and approved action.
- Evidence is stale or fabricated: evidence tasks record runtime, worker, selected skill, attempt, and freshness metadata.
- Token leaks in logs: raw tokens are never persisted and common token patterns are redacted.
- Audit artifact tampering: checksum verification reports mismatches for stored artifact payloads.
- Policy conflict permits unsafe action: policy simulation and conflict reporting should block promotion of ambiguous packs.

## Security Signoff Checklist

- Token issuance and queueing tests cover missing, expired, reused, raw-bearer, and cross-run replay cases.
- Runner tests cover manual queue bypass without credentials.
- Break-glass tests cover missing reason and severity audit logging.
- Artifact verification tests cover checksum mismatch visibility.
- Live connector rollout remains disabled until connector credentials and environment allow lists are configured outside demo fixtures.
