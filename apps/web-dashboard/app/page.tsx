import Link from "next/link";
import { ArrowRight, Database, ShieldCheck, Workflow } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";
import { Button } from "@/components/ui/button";

const foundationItems = [
  {
    title: "Governance records",
    description: "Skill runs, approvals, gate checks, tokens, attempts, logs, and audit events share the same Postgres source of truth.",
    icon: Database
  },
  {
    title: "Single runtime",
    description: "Fastify imports the runner loop so queued execution advances without Redis or a separate worker process.",
    icon: Workflow
  },
  {
    title: "Execution console",
    description: "Approved risky actions can issue scoped tokens, execute once, and stream persisted logs.",
    icon: ShieldCheck
  }
];

export default function OverviewPage() {
  return (
    <div>
      <PageHeader
        title="AgentGate Phase 3"
        description="Governed execution now connects approvals to scoped tokens, the runner, persisted logs, and complete audit traces."
      />
      <div className="mb-7 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/live">
            Open Live View
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/policies">View Policy Fixtures</Link>
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {foundationItems.map((item) => {
          const Icon = item.icon;
          return (
            <PlaceholderPanel key={item.title} title={item.title}>
              <Icon className="mb-4 h-5 w-5 text-accent" aria-hidden="true" />
              {item.description}
            </PlaceholderPanel>
          );
        })}
      </div>
    </div>
  );
}
