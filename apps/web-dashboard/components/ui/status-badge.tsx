import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  Cpu,
  Clock3,
  FlaskConical,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

type StatusKind = "decision" | "risk" | "run" | "token" | "audit" | "ai" | "approval" | "gate" | "worker" | "evidence";
type Tone = "success" | "danger" | "warning" | "running" | "missing" | "accent" | "muted" | "default";

const toneClasses: Record<Tone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  running: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  missing: "border-orange-300/30 bg-orange-300/10 text-orange-200",
  accent: "border-accent/30 bg-accent/10 text-accent",
  muted: "border-border bg-background text-muted",
  default: "border-border bg-surface text-foreground"
};

const decisionTone: Record<string, Tone> = {
  ALLOW: "success",
  DENY: "danger",
  REQUIRE_APPROVAL: "warning",
  FORCE_DRY_RUN: "running"
};

const riskTone: Record<string, Tone> = {
  info: "muted",
  low: "success",
  medium: "running",
  high: "warning",
  critical: "danger"
};

const runTone: Record<string, Tone> = {
  requested: "muted",
  classified: "running",
  policy_evaluated: "running",
  approval_required: "warning",
  approval_pending: "running",
  dry_run_required: "warning",
  dry_run_running: "running",
  dry_run_completed: "success",
  approved: "running",
  credential_issued: "running",
  execution_queued: "running",
  executing: "running",
  running: "running",
  completed: "success",
  failed: "danger",
  denied: "danger",
  rolled_back: "warning",
  audited: "success"
};

const tokenTone: Record<string, Tone> = {
  issued: "running",
  used: "success",
  expired: "warning",
  revoked: "danger"
};

const aiTone: Record<string, Tone> = {
  completed: "success",
  failed: "warning",
  disabled: "muted",
  running: "running",
  idle: "muted"
};

const gateTone: Record<string, Tone> = {
  active: "success",
  inactive: "warning",
  imported: "success",
  skipped: "muted",
  preview: "running",
  passed: "success",
  failed: "danger",
  missing: "missing",
  unknown: "muted",
  ready: "success",
  blocked: "warning",
  pending: "warning",
  running: "running",
  collecting: "running",
  approved: "running",
  denied: "danger",
  expired: "warning"
};

const workerTone: Record<string, Tone> = {
  online: "success",
  idle: "muted",
  busy: "running",
  offline: "warning",
  error: "danger"
};

const evidenceTone: Record<string, Tone> = {
  queued: "warning",
  claimed: "running",
  running: "running",
  succeeded: "success",
  failed: "danger",
  timed_out: "missing",
  cancelled: "muted"
};

function toneFor(kind: StatusKind, value: string): Tone {
  const normalized = value.toLowerCase();
  if (kind === "decision") return decisionTone[value] ?? "muted";
  if (kind === "risk") return riskTone[normalized] ?? "muted";
  if (kind === "run") return runTone[normalized] ?? "muted";
  if (kind === "token") return tokenTone[normalized] ?? "muted";
  if (kind === "ai") return aiTone[normalized] ?? "muted";
  if (kind === "gate" || kind === "approval") return gateTone[normalized] ?? "muted";
  if (kind === "worker") return workerTone[normalized] ?? "muted";
  if (kind === "evidence") return evidenceTone[normalized] ?? "muted";
  if (kind === "audit") return normalized === "complete" ? "success" : "warning";
  return "default";
}

function iconFor(kind: StatusKind, value: string) {
  const normalized = value.toLowerCase();
  if (kind === "decision" && value === "DENY") return XCircle;
  if (kind === "decision" && value === "FORCE_DRY_RUN") return FlaskConical;
  if (kind === "decision" && value === "REQUIRE_APPROVAL") return AlertTriangle;
  if (kind === "decision") return CheckCircle2;
  if (kind === "risk" && ["high", "critical"].includes(normalized)) return ShieldAlert;
  if (kind === "risk") return ShieldCheck;
  if (kind === "token") return KeyRound;
  if (kind === "ai") return BrainCircuit;
  if (kind === "audit") return normalized === "complete" ? CheckCircle2 : AlertTriangle;
  if (kind === "approval" && normalized === "blocked") return AlertTriangle;
  if (kind === "approval" && normalized === "collecting") return Clock3;
  if (kind === "gate" && normalized === "passed") return CheckCircle2;
  if (kind === "gate" && ["failed", "missing"].includes(normalized)) return AlertTriangle;
  if (kind === "gate" && ["pending", "running"].includes(normalized)) return Clock3;
  if (kind === "worker" && normalized === "busy") return Activity;
  if (kind === "worker" && normalized === "error") return AlertTriangle;
  if (kind === "worker") return Cpu;
  if (kind === "evidence" && normalized === "succeeded") return CheckCircle2;
  if (kind === "evidence" && ["failed", "timed_out"].includes(normalized)) return AlertTriangle;
  if (kind === "evidence" && ["queued", "claimed", "running"].includes(normalized)) return Clock3;
  if (kind === "run" && ["execution_queued", "running", "approval_pending"].includes(normalized)) return Clock3;
  if (kind === "run" && normalized === "failed") return XCircle;
  if (kind === "run" && normalized === "completed") return CheckCircle2;
  return CircleDashed;
}

export function StatusBadge({
  kind,
  value,
  label,
  className
}: {
  kind: StatusKind;
  value: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const displayValue = value || "n/a";
  const Icon = iconFor(kind, displayValue);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-ui border px-2 py-1 text-[11px] font-semibold uppercase tracking-normal",
        toneClasses[toneFor(kind, displayValue)],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label ?? displayValue}</span>
    </span>
  );
}
