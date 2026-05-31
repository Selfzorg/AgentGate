import { ArrowRight, CheckCircle2, GitBranch, KeyRound, RadioTower, ScrollText, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { TraceFieldScene } from "@/components/home/TraceFieldScene";

const runTiles = [
  {
    title: "Production Deploy",
    meta: "release evidence",
    href: "/approvals",
    status: "approval ready",
    tone: "emerald"
  },
  {
    title: "DB Migration",
    meta: "dry-run required",
    href: "/approvals",
    status: "guarded",
    tone: "amber"
  },
  {
    title: "Drop Table",
    meta: "destructive action",
    href: "/risk-scanner",
    status: "denied",
    tone: "rose"
  }
];

const archiveTiles = [
  {
    title: "Live Operations",
    description: "Current runs, readiness state, worker health, and execution movement.",
    href: "/live",
    span: "lg:col-span-2",
    icon: RadioTower
  },
  {
    title: "Approval Studio",
    description: "Human context, evidence checks, dry-run paths, and final decisions.",
    href: "/approvals",
    span: "",
    icon: CheckCircle2
  },
  {
    title: "Skill Registry",
    description: "Imported skills, policy bindings, expected evidence, and active versions.",
    href: "/skills",
    span: "",
    icon: Workflow
  },
  {
    title: "Policy Workshop",
    description: "Versioned rules, precedence, conflicts, status, and attachment targets.",
    href: "/policies",
    span: "",
    icon: ShieldCheck
  },
  {
    title: "Audit Trace",
    description: "Immutable run story with decision, token, execution, and log events.",
    href: "/audit",
    span: "",
    icon: ScrollText
  }
];

const processSteps = [
  {
    label: "Classify",
    text: "AgentGate resolves the skill and risk before the agent can move."
  },
  {
    label: "Collect",
    text: "Evidence workers verify the exact checks attached to the skill and policy."
  },
  {
    label: "Release",
    text: "Approved runs receive one scoped token and a persisted execution trail."
  }
];

export default function OverviewPage() {
  return (
    <div className="relative left-1/2 min-h-[100dvh] w-screen -translate-x-1/2 overflow-hidden bg-[#050806] text-white">
      <TraceFieldScene />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[900px] bg-[linear-gradient(180deg,rgb(5_8_6_/_0.04),rgb(5_8_6_/_0.72)_62%,rgb(5_8_6_/_1))]" />
      <section className="relative z-10 mx-auto grid max-w-7xl gap-12 px-6 pb-24 pt-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.72fr)] lg:items-start">
        <div className="pt-8 lg:pt-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.15] bg-white/[0.08] px-3 py-1 text-[11px] font-semibold uppercase text-emerald-100">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Governed Agent Runtime
          </div>
          <h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.96] tracking-normal text-white md:text-7xl lg:text-8xl">
            Agent actions,
            <span className="block pb-2 italic text-white/60">held to account.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-white/[0.68]">
            A command surface for risky AI operations: decisions, evidence, approval, execution tokens, logs, and audit in one trace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/live"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#07100d] transition hover:bg-emerald-100 active:translate-y-px"
            >
              Open Live View
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="/skills"
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/[0.18] px-5 text-sm font-semibold text-white transition hover:border-emerald-200/60 hover:bg-white/[0.08] active:translate-y-px"
            >
              Review Skills
            </a>
          </div>
        </div>

        <div className="relative min-h-[560px] overflow-hidden rounded-[28px] border border-white/[0.12] bg-[#0c1110]/90 p-5 shadow-[0_30px_120px_rgb(0_0_0_/_.48)] backdrop-blur">
          <div className="absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgb(16_185_129_/_0.18),transparent)]" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-xs uppercase text-white/[0.45]">Current Trace</div>
              <div className="mt-1 font-mono text-sm text-emerald-200">trc_live_9f31c2</div>
            </div>
            <div className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
              Ready
            </div>
          </div>

          <div className="relative mt-8 space-y-3">
            {[
              ["Policy", "production deploy requires approval", "matched"],
              ["Evidence", "ci, tests, rollback, staging", "passed"],
              ["Approval", "service_owner comment attached", "ready"],
              ["Token", "single-use execution credential", "issued"]
            ].map(([label, text, state], index) => (
              <div key={label} className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-300/[0.12] font-mono text-xs text-emerald-100">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase text-white/40">{label}</div>
                  <div className="truncate text-sm text-white/[0.82]">{text}</div>
                </div>
                <div className="rounded-full bg-white/[0.08] px-2 py-1 text-[11px] text-white/60">{state}</div>
              </div>
            ))}
          </div>

          <div className="relative mt-8 rounded-2xl border border-white/10 bg-black/[0.35] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <KeyRound className="h-4 w-4 text-emerald-200" aria-hidden="true" />
              Execution Envelope
            </div>
            <div className="mt-4 space-y-2 font-mono text-xs leading-6 text-white/[0.58]">
              <p>run: run_4f8a21</p>
              <p>scope: deploy-production</p>
              <p>token: issued once</p>
              <p>runner: queued</p>
            </div>
          </div>

          <div className="absolute bottom-5 left-5 right-5 grid grid-cols-3 gap-2">
            {["policy", "evidence", "audit"].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 text-center text-xs uppercase text-white/50">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-normal md:text-5xl">Run Gallery</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/[0.58]">Fast routes into the scenarios that matter most when agents touch real systems.</p>
          </div>
          <a href="/risk-scanner" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-100">
            Simulate Policy
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {runTiles.map((tile) => (
            <a
              key={tile.title}
              href={tile.href}
              className="group min-h-[260px] rounded-[24px] border border-white/10 bg-[#0b0f0e] p-5 transition hover:-translate-y-1 hover:border-emerald-200/[0.35]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs uppercase text-white/[0.42]">{tile.meta}</span>
                <span className={statusClass(tile.tone)}>{tile.status}</span>
              </div>
              <div className="mt-16">
                <GitBranch className="h-7 w-7 text-emerald-200" aria-hidden="true" />
                <h3 className="mt-5 text-2xl font-semibold text-white">{tile.title}</h3>
                <p className="mt-3 max-w-[26ch] text-sm leading-6 text-white/[0.55]">Open the trace path and inspect how governance shaped the next move.</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto grid max-w-7xl gap-10 px-6 pb-24 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h2 className="max-w-lg text-4xl font-semibold leading-none tracking-normal md:text-6xl">The approval architecture.</h2>
          <p className="mt-5 max-w-md text-sm leading-6 text-white/[0.58]">The product is built around one durable story per agent action, from first policy decision to final execution log.</p>
        </div>
        <div className="space-y-4">
          {processSteps.map((step, index) => (
            <div key={step.label} className="grid grid-cols-[56px_minmax(0,1fr)] gap-5 border-t border-white/[0.12] pt-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.04] font-mono text-xs text-white/[0.55]">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div>
                <h3 className="text-xl font-semibold text-white">{step.label}</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/[0.55]">{step.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20">
        <h2 className="text-3xl font-semibold tracking-normal md:text-5xl">Control Archives</h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {archiveTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <a
                key={tile.title}
                href={tile.href}
                className={`${tile.span} min-h-[220px] rounded-[24px] border border-white/10 bg-[#0d1211] p-6 transition hover:border-emerald-200/[0.35] hover:bg-[#111816]`}
              >
                <Icon className="h-6 w-6 text-emerald-200" aria-hidden="true" />
                <h3 className="mt-12 text-2xl font-semibold text-white">{tile.title}</h3>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/[0.55]">{tile.description}</p>
              </a>
            );
          })}
        </div>
      </section>

      <section className="relative z-10 mx-auto flex max-w-7xl flex-col gap-4 border-t border-white/[0.12] px-6 py-8 text-sm text-white/[0.48] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-200" aria-hidden="true" />
          AgentGate
        </div>
        <div>Governance, evidence, approval, execution, audit.</div>
      </section>
    </div>
  );
}

function statusClass(tone: string) {
  const base = "rounded-full border px-2.5 py-1 text-[11px] font-semibold";
  if (tone === "amber") return `${base} border-amber-300/[0.35] bg-amber-300/10 text-amber-100`;
  if (tone === "rose") return `${base} border-rose-300/[0.35] bg-rose-300/10 text-rose-100`;
  return `${base} border-emerald-300/[0.35] bg-emerald-300/10 text-emerald-100`;
}
