import Link from "next/link";
import {
  Activity,
  Bot,
  Braces,
  CheckCircle2,
  Database,
  FileSearch,
  GitBranch,
  Network,
  ShieldCheck,
  Split,
  Table2,
  TerminalSquare,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

const productSurfaces = [
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
    purpose: "Review approval packets, gate checks, comments, force dry-run, deny, approve, and retry evidence."
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
    purpose: "Issue execution tokens, queue execution, stream logs, retry failed runs, and generate AI insights."
  },
  {
    name: "Audit",
    path: "/audit",
    purpose: "Search audit traces and verify lifecycle completeness."
  },
  {
    name: "Risk Scanner",
    path: "/risk-scanner",
    purpose: "Simulate fixture-backed payloads without creating governance side effects."
  },
  {
    name: "Skills / Policies",
    path: "/skills + /policies",
    purpose: "Inspect active skill registry records and policy fixtures loaded into Postgres."
  }
];

const userFlows = [
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
      "Human approver must approve; critical/high-risk execution still needs an execution token."
    ],
    outcome: "No production side effect. Governance lifecycle is real; execution is simulated after approval."
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
      "Execution token endpoint issues a scoped token record and returns only token status/id metadata to the browser.",
      "Execution request validates approval, token scope, environment, TTL, and idempotency key.",
      "SkillRun status becomes execution_queued.",
      "Single-process runner loop claims queued runs, writes ExecutionLog rows, calls simulated connector, and finalizes audit."
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

const architectureLayers = [
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
    detail: "Validates approval and token scope before a simulated connector writes logs and finalizes the run."
  },
  {
    layer: "Observability",
    pieces: "Audit events, audit integrity, execution logs, SSE, AI analysis",
    detail: "Provides trace completeness, log streaming, and run-level insight generation."
  }
];

const techStack = [
  ["Monorepo", "pnpm workspaces", "Coordinates apps and packages from one repo."],
  ["Web", "Next.js 15, React 19, Tailwind, lucide-react", "Dashboard UI, system guide, evidence monitor, approvals, execution console."],
  ["API", "Fastify 5, Zod", "HTTP routes, request validation, CORS, SSE responses."],
  ["Database", "PostgreSQL, Prisma", "Source of truth for runs, policies, approvals, evidence, tokens, attempts, logs, and audit."],
  ["Governance packages", "@agentgate/skill-resolver, risk-engine, policy-engine", "Action classification, risk scoring, and policy decisioning."],
  ["Agent integrations", "Claude Code hooks, MCP SDK, AgentGate MCP proxy", "Claude/Codex can call governed tools and evidence task APIs."],
  ["Runner", "@agentgate/runner-worker inside API process", "Single-process MVP DB-backed queue consumer."],
  ["Tests", "Vitest, ESLint, TypeScript", "Governance, demo, integration, runner, audit, AI, and worker coverage."]
];

const apiGroups = [
  ["Decision", "POST /api/v1/decision, POST /api/v1/mcp/invoke", "Creates governed SkillRun records and returns policy decision."],
  ["Demo", "GET /demo/actions, POST /demo/actions/:id/replay, POST /demo/scenario/replay", "Fixture-backed demo entrypoints."],
  ["Approvals", "GET /approvals, approve, deny, force-dry-run, retry evidence", "Human approval packet workflow."],
  ["Evidence", "GET /evidence-monitor, /evidence-tasks, claim, heartbeat, complete, fail", "Worker queue and evidence lifecycle."],
  ["Execution", "POST /execution-tokens, POST /skill-runs/:id/execute, retry, dry-run", "Scoped token issue and DB-backed execution queue."],
  ["Audit and logs", "GET /audit-events, /audit-integrity, /skill-runs/:id/logs", "Trace inspection and SSE log streaming."],
  ["Catalog", "GET /skills, GET /policies", "Registry and policy browser."],
  ["AI insights", "GET/POST /skill-runs/:id/ai-analysis, POST /audit/:trace/ai-summary", "Run and audit summarization with redaction."]
];

const schemaGroups = [
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

const coreRelationships = [
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

export function SystemGuide() {
  return (
    <div className="space-y-6">
      <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">AgentGate Map</h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-muted">
              AgentGate is a governance control plane for AI agent tool use. It records decisions, evidence, approval,
              scoped tokens, simulated execution, logs, and audit traces in Postgres.
            </p>
          </div>
          <StatusBadge kind="run" value="policy_evaluated" label="DB-backed MVP" />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <SummaryTile icon={ShieldCheck} title="Governance" text="Decision API, policy evaluation, risk scoring, approvals, and audit." />
          <SummaryTile icon={Bot} title="Agent Entry" text="Claude hooks, MCP proxy tools, demo fixtures, and dashboard triggers." />
          <SummaryTile icon={Database} title="State" text="Postgres stores every queue, token, log, evidence, and trace transition." />
        </div>
      </section>

      <GuideSection id="product" icon={Activity} title="Available Functionality">
        <div className="overflow-x-auto">
          <table className="min-w-[820px] w-full border-collapse text-left text-sm">
            <thead className="bg-background text-xs uppercase text-muted">
              <tr>
                <th className="border-b border-border px-4 py-3 font-medium">Surface</th>
                <th className="border-b border-border px-4 py-3 font-medium">Path</th>
                <th className="border-b border-border px-4 py-3 font-medium">What It Does</th>
              </tr>
            </thead>
            <tbody>
              {productSurfaces.map((surface) => (
                <tr key={surface.name} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium">{surface.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-accent">
                    {surface.path.startsWith("/") && !surface.path.includes("[") && !surface.path.includes("+") ? (
                      <Link href={surface.path}>{surface.path}</Link>
                    ) : (
                      surface.path
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{surface.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection id="journeys" icon={Workflow} title="User Journeys">
        <div className="grid gap-4">
          {userFlows.map((flow, index) => (
            <article key={flow.title} className="rounded-ui border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {index + 1}. {flow.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted">{flow.actor}</p>
                </div>
                <StatusBadge kind="approval" value={index === 3 ? "denied" : index === 0 ? "ready" : "collecting"} />
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">
                <span className="font-medium text-foreground">Trigger:</span> {flow.trigger}
              </p>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-muted">
                {flow.steps.map((step) => (
                  <li key={step} className="grid grid-cols-[24px_1fr] gap-2">
                    <CheckCircle2 className="mt-1 h-4 w-4 text-success" aria-hidden="true" />
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-sm leading-6">
                <span className="font-medium">Outcome:</span> <span className="text-muted">{flow.outcome}</span>
              </p>
            </article>
          ))}
        </div>
      </GuideSection>

      <GuideSection id="architecture" icon={Network} title="Architecture Flow">
        <div className="grid gap-3 lg:grid-cols-2">
          {architectureLayers.map((layer) => (
            <div key={layer.layer} className="rounded-ui border border-border bg-background p-4">
              <h3 className="text-sm font-semibold">{layer.layer}</h3>
              <p className="mt-2 font-mono text-xs leading-5 text-muted">{layer.pieces}</p>
              <p className="mt-3 text-sm leading-6 text-muted">{layer.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-ui border border-border bg-background p-4">
          <h3 className="text-sm font-semibold">Core Sequence</h3>
          <p className="mt-2 font-mono text-xs leading-6 text-muted">
            Agent tool call -&gt; normalize action -&gt; resolve skill -&gt; score risk -&gt; evaluate policy -&gt; persist SkillRun -
            &gt; collect evidence or dry-run or deny -&gt; approval -&gt; scoped token -&gt; execution queue -&gt; runner -
            &gt; logs and audit finalized.
          </p>
        </div>
      </GuideSection>

      <GuideSection id="stack" icon={TerminalSquare} title="Tools And Tech Stack">
        <KeyValueTable rows={techStack} headings={["Layer", "Tooling", "How It Is Used"]} />
      </GuideSection>

      <GuideSection id="api" icon={Braces} title="API And Tool Surfaces">
        <KeyValueTable rows={apiGroups} headings={["Group", "Endpoints", "Purpose"]} />
      </GuideSection>

      <GuideSection id="registry" icon={GitBranch} title="Skill And Policy Registry">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-ui border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">Registry Sources</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
              <li>configs/demo-skills.yaml defines connectors, execution skills, and evidence skills.</li>
              <li>configs/demo-policies.yaml defines policy precedence, decisions, required checks, and approvers.</li>
              <li>prisma/seed.ts loads fixtures into skills, skill_versions, policies, and policy_versions.</li>
              <li>evidence-skill-registry.ts resolves a required check by matching SkillVersion.config.check_key.</li>
            </ul>
          </div>
          <div className="rounded-ui border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">Evidence Skill Contract</h3>
            <dl className="mt-3 grid gap-2 text-sm">
              <Definition label="skill_type" value="Must be evidence." />
              <Definition label="side_effect_level" value="Must be read_only for evidence runtime execution." />
              <Definition label="check_key" value="Matches policy required_checks." />
              <Definition label="allowed_runtimes" value="Runtimes permitted to claim/execute the check." />
              <Definition label="preferred_runtimes" value="Runtime order used when tasks are created." />
            </dl>
          </div>
        </div>
      </GuideSection>

      <GuideSection id="schema" icon={Table2} title="Database Schema And Relationships">
        <div className="rounded-ui border border-border bg-background p-4">
          <h3 className="text-sm font-semibold">Relationship Spine</h3>
          <div className="mt-3 grid gap-2 text-sm text-muted md:grid-cols-2">
            {coreRelationships.map((item) => (
              <div key={item} className="flex gap-2">
                <Split className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {schemaGroups.map((group) => (
            <div key={group.group}>
              <h3 className="text-sm font-semibold">{group.group}</h3>
              <div className="mt-2 overflow-x-auto rounded-ui border border-border">
                <table className="min-w-[920px] w-full border-collapse text-left text-sm">
                  <thead className="bg-background text-xs uppercase text-muted">
                    <tr>
                      <th className="border-b border-border px-4 py-3 font-medium">Table</th>
                      <th className="border-b border-border px-4 py-3 font-medium">Purpose</th>
                      <th className="border-b border-border px-4 py-3 font-medium">Important Fields</th>
                      <th className="border-b border-border px-4 py-3 font-medium">Relationships</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.tables.map((table) => (
                      <tr key={table.name} className="border-b border-border bg-surface last:border-b-0">
                        <td className="px-4 py-3 font-mono text-xs text-accent">{table.name}</td>
                        <td className="px-4 py-3 text-muted">{table.purpose}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{table.keyFields}</td>
                        <td className="px-4 py-3 text-muted">{table.relationships}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </GuideSection>

      <GuideSection id="limits" icon={FileSearch} title="Current Design Boundaries">
        <div className="grid gap-3 md:grid-cols-2">
          <Boundary title="Governance is real" text="Decisions, approvals, evidence, token records, logs, audit events, and queues are persisted." />
          <Boundary title="Side effects are simulated" text="GitHub, Vercel, database, Kubernetes, and production mutations are not called by the MVP runner." />
          <Boundary title="Evidence skills are registry-resolved" text="Checks map through skill_versions.config.check_key, but several demo pass/fail semantics still live in runtime code." />
          <Boundary title="Single-process runtime" text="Fastify imports the runner loop for the MVP. Evidence worker can be external through Claude/Codex/MCP." />
        </div>
      </GuideSection>
    </div>
  );
}

function GuideSection({
  id,
  icon: Icon,
  title,
  children
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SummaryTile({
  icon: Icon,
  title,
  text
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-ui border border-border bg-background p-4">
      <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
    </div>
  );
}

function KeyValueTable({ rows, headings }: { rows: string[][]; headings: string[] }) {
  return (
    <div className="overflow-x-auto rounded-ui border border-border">
      <table className="min-w-[820px] w-full border-collapse text-left text-sm">
        <thead className="bg-background text-xs uppercase text-muted">
          <tr>
            {headings.map((heading) => (
              <th key={heading} className="border-b border-border px-4 py-3 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join(":")} className="border-b border-border bg-surface last:border-b-0">
              <td className="px-4 py-3 font-medium">{row[0]}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted">{row[1]}</td>
              <td className="px-4 py-3 text-muted">{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
      <dt className="font-mono text-xs text-accent">{label}</dt>
      <dd className="text-muted">{value}</dd>
    </div>
  );
}

function Boundary({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-ui border border-border bg-background p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
    </div>
  );
}
