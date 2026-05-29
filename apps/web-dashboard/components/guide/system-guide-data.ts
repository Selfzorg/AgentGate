export const productSurfaces = [
  {
    name: "Overview",
    path: "/",
    purpose: "Phase 3 landing surface with links into live activity and policy fixtures."
  },
  {
    name: "Live Activity",
    path: "/live",
    purpose: "Replay demo actions and watch persisted decisions, risk, policies, run links, and audit links."
  },
  {
    name: "Approvals",
    path: "/approvals",
    purpose: "Review gate checks, retry evidence, approve, deny, and continue approved runs."
  },
  {
    name: "Evidence Monitor",
    path: "/evidence",
    purpose: "Inspect evidence queue state, Claude/Codex worker heartbeat, task lifecycle, and evidence audit events."
  },
  {
    name: "Skill Runs",
    path: "/skill-runs",
    purpose: "Browse governed runs and open execution consoles for run detail."
  },
  {
    name: "Run Detail",
    path: "/skill-runs/[runId]",
    purpose: "Follow token, Claude handoff or connector execution, completion, logs, and AI insights."
  },
  {
    name: "Audit",
    path: "/audit",
    purpose: "Search audit traces and verify lifecycle completeness."
  },
  {
    name: "Risk Scanner",
    path: "/risk-scanner",
    purpose: "Build simulation payloads from fixtures or imported skills without creating governance side effects."
  },
  {
    name: "Skills / Policies",
    path: "/skills + /policies",
    purpose: "Scan real Claude/Codex/MCP skills, review evidence and aliases, import versions, and inspect policies."
  }
];

export const userFlows = [
  {
    title: "Safe Local Command",
    actor: "Claude Code hook, MCP proxy, or demo launcher",
    trigger: "Run tests or create a low-risk PR action.",
    steps: [
      "Action request is normalized into tenant, workspace, source, tool, raw_action, agent, and context.",
      "Skill resolver maps the command to run-tests or create-pr.",
      "Risk engine scores low risk.",
      "Policy engine returns ALLOW.",
      "SkillRun and audit events are persisted. The dashboard shows the run in Live Activity."
    ],
    outcome: "Allowed without approval or execution token."
  },
  {
    title: "Production Deploy Approval",
    actor: "Claude Code MCP tool or Bash hook",
    trigger: "Deploy production, for example agentgate_deploy_production or vercel deploy --prod.",
    steps: [
      "Decision API resolves deploy-production and evaluates production_deploy_requires_approval.",
      "SkillRun, GateCheckResult rows, ApprovalRequest, and audit events are created.",
      "Evidence collection resolves each required check to an evidence skill and creates EvidenceTask rows.",
      "Claude evidence worker heartbeats, claims tasks, runs read-only evidence collection, and submits results.",
      "Approval readiness becomes ready only after all gate checks pass.",
      "Human approver must approve; critical/high-risk execution continues through a scoped token and run-level handoff."
    ],
    outcome: "Governance lifecycle is real. Demo connectors simulate side effects; imported Claude skills can be continued explicitly in Claude Code."
  },
  {
    title: "Production DB Migration",
    actor: "MCP proxy, demo launcher, or direct API",
    trigger: "Apply a production migration before dry-run evidence exists.",
    steps: [
      "Decision API resolves run-db-migration.",
      "Policy production_db_migration_force_dry_run_first returns FORCE_DRY_RUN.",
      "Force Dry-Run creates DryRunResult and sets dry_run_completed, schema_diff_generated, and backup_exists context flags.",
      "Post-dry-run policy requires approval and creates/updates gate checks.",
      "Approval, token issue, execution queue, runner logs, and audit lifecycle proceed after approval."
    ],
    outcome: "Dry-run evidence first, then approval, then scoped simulated execution."
  },
  {
    title: "Denied Destructive Action",
    actor: "MCP proxy, hook, or demo action",
    trigger: "Drop table, research-agent production deploy, or blocked destructive action.",
    steps: [
      "Skill resolver maps the action to drop-table or deploy-production.",
      "Risk and policy engine apply high-priority deny policy.",
      "SkillRun is persisted as denied.",
      "Audit trace captures received, classified, risk.scored, and policy.evaluated events."
    ],
    outcome: "Denied. No approval packet, token, or execution queue is created."
  },
  {
    title: "Approved Execution",
    actor: "Service owner in dashboard",
    trigger: "Approval packet has all gate checks passed and a required comment for critical risk.",
    steps: [
      "Approver grants approval.",
      "Execution token endpoint issues a scoped token and stores only its hash after the one-time handoff.",
      "Imported Claude skills use Continue in Claude so Claude receives the exact approved skill body and then calls completion.",
      "Non-Claude connector execution validates approval, token scope, environment, TTL, and idempotency key.",
      "The single-process runner loop claims queued connector runs, writes ExecutionLog rows, and finalizes audit."
    ],
    outcome: "Persisted execution attempt, logs, final run state, and complete audit trace."
  },
  {
    title: "Evidence Retry",
    actor: "Approver or operator",
    trigger: "A gate check is missing/failed/stale or needs revalidation.",
    steps: [
      "Retry evidence creates a new EvidenceTask attempt for one check or all checks.",
      "Older active tasks for that gate check are cancelled.",
      "Worker claims the newest task and records heartbeat status.",
      "GateCheckResult evidence and ApprovalRequest readiness are recomputed."
    ],
    outcome: "One failed check can be repaired without recreating the whole run."
  },
  {
    title: "Risk Scanner Simulation",
    actor: "Dashboard user",
    trigger: "Pick a fixture or submit a payload in /risk-scanner.",
    steps: [
      "Payload is normalized and passed through skill resolver, risk engine, policy engine, and gate-check preview.",
      "No SkillRun, token, approval, evidence task, or audit side effect is written.",
      "The UI shows expected decision, policy, required checks, and rationale."
    ],
    outcome: "Safe policy debugging without mutating governance state."
  }
];

export const architectureLayers = [
  {
    layer: "Agent Entry",
    pieces: "Claude Code PreToolUse hook, Claude SessionStart worker hook, MCP proxy, demo dashboard",
    detail: "Normalizes Bash/Edit/Write/MCP tool events and sends governed actions to AgentGate."
  },
  {
    layer: "API Runtime",
    pieces: "Fastify, Zod, Prisma, config loader",
    detail: "Owns decision, approval, evidence, token, execution, audit, catalog, risk scanner, and SSE endpoints."
  },
  {
    layer: "Governance Engines",
    pieces: "skill-resolver, risk-engine, policy-engine",
    detail: "Maps raw actions to skills, scores risk, applies policy precedence, and produces ALLOW/DENY/REQUIRE_APPROVAL/FORCE_DRY_RUN."
  },
  {
    layer: "Evidence Pipeline",
    pieces: "Evidence skill registry, evidence_tasks, evidence_workers, Claude evidence worker",
    detail: "Converts policy checks into read-only evidence work and records each gate check result."
  },
  {
    layer: "Execution Runtime",
    pieces: "Execution token service, DB-backed queue, runner loop, simulated connectors",
    detail: "Validates approval and token scope before Claude handoff or simulated connector execution finalizes the run."
  },
  {
    layer: "Observability",
    pieces: "Audit events, audit integrity, execution logs, SSE, AI analysis",
    detail: "Provides trace completeness, log streaming, and run-level insight generation."
  }
];

export const techStack = [
  ["Monorepo", "pnpm workspaces", "Coordinates apps and packages from one repo."],
  ["Web", "Next.js 15, React 19, Tailwind, lucide-react", "Dashboard UI, system guide, evidence monitor, approvals, execution console."],
  ["API", "Fastify 5, Zod", "HTTP routes, request validation, CORS, SSE responses."],
  ["Database", "PostgreSQL, Prisma", "Source of truth for runs, policies, approvals, evidence, tokens, attempts, logs, and audit."],
  ["Governance packages", "@agentgate/skill-resolver, risk-engine, policy-engine", "Action classification, risk scoring, and policy decisioning."],
  ["Agent integrations", "Claude Code hooks, MCP SDK, AgentGate MCP proxy", "Claude/Codex can call governed tools and evidence task APIs."],
  ["Runner", "@agentgate/runner-worker inside API process", "Single-process MVP DB-backed queue consumer."],
  ["Tests", "Vitest, ESLint, TypeScript", "Governance, demo, integration, runner, audit, AI, and worker coverage."]
];

export const apiGroups = [
  ["Decision", "POST /api/v1/decision, POST /api/v1/mcp/invoke", "Creates governed SkillRun records and returns policy decision."],
  ["Demo", "GET /demo/actions, POST /demo/actions/:id/replay, POST /demo/scenario/replay", "Fixture-backed demo entrypoints."],
  ["Approvals", "GET /approvals, approve, deny, force-dry-run, retry evidence", "Human approval packet workflow."],
  ["Evidence", "GET /evidence-monitor, /evidence-tasks, claim, heartbeat, complete, fail", "Worker queue and evidence lifecycle."],
  ["Execution", "POST /execution-tokens, POST /skill-runs/:id/execute, retry, dry-run", "Scoped token issue and DB-backed execution queue."],
  ["Audit and logs", "GET /audit-events, /audit-integrity, /skill-runs/:id/logs", "Trace inspection and SSE log streaming."],
  ["Catalog", "GET /skills, GET /policies", "Registry and policy browser."],
  ["AI insights", "GET/POST /skill-runs/:id/ai-analysis, POST /audit/:trace/ai-summary", "Run and audit summarization with redaction."]
];

export const schemaGroups = [
  {
    group: "Tenant and Workspace",
    tables: [
      {
        name: "tenants",
        purpose: "Top-level account boundary.",
        keyFields: "id, name, status",
        relationships: "Owns every workspace-scoped table."
      },
      {
        name: "workspaces",
        purpose: "Operational workspace under a tenant.",
        keyFields: "id, tenant_id, key, name",
        relationships: "Parent for agents, skills, policies, runs, evidence, tokens, logs, and audit."
      },
      {
        name: "users",
        purpose: "Human actors for ownership and approval decisions.",
        keyFields: "id, tenant_id, email, role",
        relationships: "Owns agents; can approve or deny ApprovalRequest."
      },
      {
        name: "agents",
        purpose: "External AI agent identity.",
        keyFields: "external_agent_id, source, agent_type, role",
        relationships: "SkillRun.agent_id points here when known."
      }
    ]
  },
  {
    group: "Registry",
    tables: [
      {
        name: "connectors",
        purpose: "Connector records for GitHub, DB, and deployment integrations.",
        keyFields: "connector_id, type, config",
        relationships: "SkillVersion may reference connector_id."
      },
      {
        name: "skills",
        purpose: "Skill registry root, including execution and evidence skills.",
        keyFields: "skill_id, name, category, default_risk_level",
        relationships: "Has SkillVersion; SkillRun may reference skill_record_id."
      },
      {
        name: "skill_versions",
        purpose: "Versioned skill config and execution requirements.",
        keyFields: "version, config, execution, connector_id",
        relationships: "Evidence skills store check_key, skill_type, side_effect_level, allowed/preferred runtimes in config."
      },
      {
        name: "policies",
        purpose: "Policy registry root.",
        keyFields: "policy_id, name, status",
        relationships: "Has PolicyVersion; SkillRun may reference matched_policy_record_id."
      },
      {
        name: "policy_versions",
        purpose: "Policy decision rules and required checks.",
        keyFields: "priority, decision, definition, required_checks, approvers",
        relationships: "Evaluated by policy engine after risk scoring."
      }
    ]
  },
  {
    group: "Governance Run",
    tables: [
      {
        name: "skill_runs",
        purpose: "Core governance record for every decision.",
        keyFields: "trace_id, raw_action, decision, risk_level, status, context, snapshots",
        relationships: "Parent for gate checks, approval, tokens, attempts, logs, dry-run, evidence tasks, audit, and AI analysis."
      },
      {
        name: "gate_check_results",
        purpose: "Per-policy prerequisite state.",
        keyFields: "skill_run_id, check_key, status, evidence",
        relationships: "EvidenceTask rows attach to a gate check; approval readiness is derived from these statuses."
      },
      {
        name: "approval_requests",
        purpose: "Human approval packet.",
        keyFields: "skill_run_id, status, risk_level, approval_readiness, missing_checks, required_approvers, comment",
        relationships: "One per SkillRun; links to ExecutionToken and EvidenceTask."
      },
      {
        name: "dry_run_results",
        purpose: "Result packet for FORCE_DRY_RUN migration path.",
        keyFields: "skill_run_id, status, summary, result, artifacts",
        relationships: "One per SkillRun; dry-run updates run context and approval state."
      }
    ]
  },
  {
    group: "Evidence",
    tables: [
      {
        name: "evidence_tasks",
        purpose: "DB-backed queue for read-only evidence work.",
        keyFields: "skill_run_id, gate_check_result_id, check_key, evidence_skill_id, runtime, status, attempt, lease",
        relationships: "Created from required gate checks; claimed/completed by evidence workers."
      },
      {
        name: "evidence_workers",
        purpose: "Worker heartbeat and current-task monitor.",
        keyFields: "agent_id, runtime, driver, status, current_task_id, processed_count, failed_count, last_heartbeat_at",
        relationships: "References tenant/workspace; current_task_id stores the active EvidenceTask id."
      }
    ]
  },
  {
    group: "Execution",
    tables: [
      {
        name: "execution_tokens",
        purpose: "Scoped, expiring execution credential record.",
        keyFields: "skill_run_id, approval_request_id, token_hash, scopes, environment, status, expires_at",
        relationships: "SkillRunAttempt may reference the token; raw token is not exposed after creation."
      },
      {
        name: "skill_run_attempts",
        purpose: "Idempotent execution attempt queue item.",
        keyFields: "skill_run_id, execution_token_id, idempotency_key, status, result, error",
        relationships: "Runner marks queued/executing/completed/failed."
      },
      {
        name: "execution_logs",
        purpose: "Persisted ordered logs emitted by runner.",
        keyFields: "skill_run_id, sequence, level, message, metadata",
        relationships: "SSE streams these rows; audit records log emission events."
      }
    ]
  },
  {
    group: "Audit and Intelligence",
    tables: [
      {
        name: "audit_events",
        purpose: "Append-only lifecycle trace events.",
        keyFields: "trace_id, skill_run_id, event_type, actor_type, actor_id, sequence, metadata",
        relationships: "Audit integrity checks lifecycle completeness by trace."
      },
      {
        name: "audit_artifacts",
        purpose: "Optional files or external artifacts attached to audit events.",
        keyFields: "audit_event_id, skill_run_id, artifact_id, type, uri, metadata",
        relationships: "Belongs to AuditEvent and optionally SkillRun."
      },
      {
        name: "ai_run_analyses",
        purpose: "Generated run insight packet.",
        keyFields: "skill_run_id, trace_id, summary, severity, missing_evidence, suggested_actions, token/cost metadata",
        relationships: "One analysis per SkillRun."
      }
    ]
  }
];

export const coreRelationships = [
  "Tenant -> Workspace -> everything else",
  "Agent -> SkillRun records external AI actor identity",
  "Skill + SkillVersion -> SkillRun.resolvedSkillSnapshot and evidence task skill lookup",
  "Policy + PolicyVersion -> SkillRun.policySnapshot and matchedPolicy",
  "SkillRun -> GateCheckResult -> EvidenceTask",
  "SkillRun -> ApprovalRequest -> ExecutionToken",
  "SkillRun -> SkillRunAttempt -> ExecutionLog",
  "SkillRun -> AuditEvent -> AuditArtifact",
  "SkillRun -> DryRunResult for FORCE_DRY_RUN migration path",
  "SkillRun -> AiRunAnalysis for generated run insights"
];
