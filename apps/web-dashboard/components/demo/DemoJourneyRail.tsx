import { BrainCircuit, Eye, FileClock, KeyRound, ListChecks, Radio, Route, ShieldCheck, Zap } from "lucide-react";
import { getDemoContract } from "@/lib/api-client";

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

const fallbackModes = [
  {
    id: "without_agentgate",
    label: "Without AgentGate",
    description: "The agent attempts the action directly; no durable run or evidence is created."
  },
  {
    id: "observe",
    label: "AgentGate observe mode",
    description: "AgentGate records decision context while allowing local action to continue."
  },
  {
    id: "enforce",
    label: "AgentGate enforce mode",
    description: "AgentGate blocks risky action until evidence, approval, token, execution, logs, and audit complete."
  }
] as const;

const modeIcons = {
  without_agentgate: Zap,
  observe: Eye,
  enforce: ShieldCheck
};

export async function DemoJourneyRail() {
  const modes = await getDemoContract()
    .then((response) => response.contract.modes)
    .catch(() => fallbackModes);

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
      <div className="mb-4 grid gap-2 md:grid-cols-3">
        {modes.map((mode) => {
          const Icon = modeIcons[mode.id];
          return (
            <div key={mode.id} className="rounded-ui border border-border bg-background p-3">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
                <div className="text-sm font-semibold">{mode.label}</div>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">{mode.description}</p>
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {journey.map((step, index) => {
          const Icon = step.icon;
          return (
            <a
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
            </a>
          );
        })}
      </div>
    </section>
  );
}
