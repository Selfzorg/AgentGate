import Link from "next/link";
import { ArrowRight, Database, ShieldCheck, Workflow } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";
import { Button } from "@/components/ui/button";

const foundationItems = [
  {
    title: "Schema baseline",
    description: "Complete Prisma ownership graph, relations, indexes, and uniqueness rules are ready for migration.",
    icon: Database
  },
  {
    title: "Single runtime",
    description: "Fastify imports the runner loop for the single-process MVP model.",
    icon: Workflow
  },
  {
    title: "Governance shell",
    description: "Dashboard routes are present but product behavior starts in later phases.",
    icon: ShieldCheck
  }
];

export default function OverviewPage() {
  return (
    <div>
      <PageHeader
        title="AgentGate Phase 0"
        description="Repository foundation for the runtime control plane. Product decisions, approvals, execution, and SSE streams start after the schema-first baseline is verified."
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
