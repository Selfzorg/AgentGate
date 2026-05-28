import Link from "next/link";
import { BrainCircuit, FileClock, KeyRound, ListChecks, Radio, Route, ShieldCheck } from "lucide-react";

const journey = [
  {
    label: "Action",
    detail: "Replay fixture",
    href: "/live",
    icon: Radio
  },
  {
    label: "Decision",
    detail: "Policy result",
    href: "/live",
    icon: ShieldCheck
  },
  {
    label: "Approval",
    detail: "Evidence packet",
    href: "/approvals",
    icon: ListChecks
  },
  {
    label: "Token",
    detail: "Scoped issue",
    href: "/skill-runs",
    icon: KeyRound
  },
  {
    label: "Logs",
    detail: "SSE stream",
    href: "/skill-runs",
    icon: Route
  },
  {
    label: "Audit",
    detail: "Trace complete",
    href: "/audit",
    icon: FileClock
  },
  {
    label: "AI Insights",
    detail: "Advisory card",
    href: "/skill-runs",
    icon: BrainCircuit
  }
];

export function DemoJourneyRail() {
  return (
    <section className="mb-5 rounded-ui border border-border bg-surface p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Demo Journey</h2>
          <p className="mt-1 text-xs text-muted">
            Follow one action from deterministic decisioning through execution evidence.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {journey.map((step, index) => {
          const Icon = step.icon;
          return (
            <Link
              key={step.label}
              href={step.href}
              className="rounded-ui border border-border bg-background p-3 text-sm transition-colors hover:border-accent hover:bg-surface"
            >
              <div className="flex items-center justify-between gap-2">
                <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
                <span className="font-mono text-[11px] text-muted">{index + 1}</span>
              </div>
              <div className="mt-3 font-semibold">{step.label}</div>
              <div className="mt-1 text-xs text-muted">{step.detail}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
