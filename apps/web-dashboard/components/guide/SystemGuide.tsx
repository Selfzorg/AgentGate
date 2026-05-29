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

import { apiGroups, architectureLayers, coreRelationships, productSurfaces, schemaGroups, techStack, userFlows } from "./system-guide-data";

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
                      <a href={surface.path}>{surface.path}</a>
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
            &gt; Claude handoff or connector execution -&gt; logs and audit finalized.
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
