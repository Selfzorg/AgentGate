import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FlaskConical,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

type StatusKind = "decision" | "risk" | "run" | "token" | "audit" | "ai" | "approval" | "gate";
type Tone = "success" | "danger" | "warning" | "accent" | "muted" | "default";

const toneClasses: Record<Tone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  accent: "border-accent/30 bg-accent/10 text-accent",
  muted: "border-border bg-background text-muted",
  default: "border-border bg-surface text-foreground"
};

const decisionTone: Record<string, Tone> = {
  ALLOW: "success",
  DENY: "danger",
  REQUIRE_APPROVAL: "warning",
  FORCE_DRY_RUN: "accent"
};

const riskTone: Record<string, Tone> = {
  info: "muted",
  low: "success",
  medium: "accent",
  high: "warning",
  critical: "danger"
};

const runTone: Record<string, Tone> = {
  policy_evaluated: "success",
  approval_required: "warning",
  dry_run_required: "accent",
  approved: "success",
  credential_issued: "accent",
  execution_queued: "accent",
  running: "accent",
  completed: "success",
  failed: "danger",
  denied: "danger"
};

const tokenTone: Record<string, Tone> = {
  issued: "accent",
  used: "success",
  expired: "warning",
  revoked: "danger"
};

const aiTone: Record<string, Tone> = {
  completed: "success",
  failed: "warning",
  disabled: "muted",
  running: "accent",
  idle: "muted"
};

const gateTone: Record<string, Tone> = {
  passed: "success",
  failed: "danger",
  missing: "warning",
  unknown: "muted",
  ready: "success",
  blocked: "warning",
  pending: "warning",
  approved: "success",
  denied: "danger",
  expired: "warning"
};

function toneFor(kind: StatusKind, value: string): Tone {
  const normalized = value.toLowerCase();
  if (kind === "decision") return decisionTone[value] ?? "muted";
  if (kind === "risk") return riskTone[normalized] ?? "muted";
  if (kind === "run") return runTone[normalized] ?? "muted";
  if (kind === "token") return tokenTone[normalized] ?? "muted";
  if (kind === "ai") return aiTone[normalized] ?? "muted";
  if (kind === "gate" || kind === "approval") return gateTone[normalized] ?? "muted";
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
  if (kind === "gate" && normalized === "passed") return CheckCircle2;
  if (kind === "gate" && ["failed", "missing"].includes(normalized)) return AlertTriangle;
  if (kind === "run" && ["execution_queued", "running"].includes(normalized)) return Clock3;
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
