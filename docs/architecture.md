# Architecture

AgentGate is a schema-first TypeScript monorepo.

```mermaid
flowchart LR
  Agent["AI agent / MCP client"] --> Adapter["Hook or MCP adapter"]
  Adapter --> Decision["Decision API"]
  Decision --> Resolver["Skill Resolver"]
  Resolver --> Risk["Risk Engine"]
  Risk --> Policy["Policy Engine"]
  Policy --> Approval["Approval Queue"]
  Policy --> Runner["Internal Runner Loop"]
  Approval --> Token["Execution Token"]
  Token --> Runner
  Runner --> Logs["execution_logs"]
  Decision --> Audit["audit_events"]
  Runner --> Audit
  Logs --> Dashboard["Dashboard SSE consumers"]
```

Phase 0 provides the repository foundation, complete Prisma schema, deterministic fixtures, placeholder apps, and local Postgres setup. Later phases fill in the decision pipeline, approval lifecycle, dry-run evidence, token validation, runner state machine, and SSE streaming.
