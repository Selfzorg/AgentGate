import { CheckCircle2, Circle, Clock3, XCircle } from "lucide-react";

type ImportStage = "start" | "scanned" | "review" | "imported" | "rejected";

const importSteps: Array<{ key: ImportStage; label: string }> = [
  { key: "start", label: "Discover" },
  { key: "scanned", label: "Snapshot" },
  { key: "review", label: "Review" },
  { key: "imported", label: "Use" }
];

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-ui border border-border bg-background p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

export function SourcePill({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-ui border border-border bg-background px-2 py-1 font-mono text-[11px] uppercase text-muted">
      {value}
    </span>
  );
}

export function ImportStepRail({ stage }: { stage: ImportStage }) {
  const activeIndex = Math.max(
    0,
    importSteps.findIndex((step) => step.key === stage)
  );

  return (
    <div className="mt-5 grid gap-2 md:grid-cols-4">
      {importSteps.map((step, index) => {
        const isDone = stage === "imported" || index < activeIndex;
        const isActive = index === activeIndex && stage !== "imported";
        const Icon = isDone ? CheckCircle2 : isActive ? Clock3 : Circle;

        return (
          <div
            key={step.key}
            className={`rounded-ui border p-3 text-sm ${
              isActive
                ? "border-accent bg-accent/5 text-foreground"
                : isDone
                  ? "border-success/40 bg-success/10 text-foreground"
                  : "border-border bg-background text-muted"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">
                {index + 1}. {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ImportNextStep({
  stage,
  selectedCount,
  batchStatus
}: {
  stage: ImportStage;
  selectedCount: number;
  batchStatus?: string | null;
}) {
  const copy = nextStepCopy(stage, selectedCount, batchStatus);
  const Icon = stage === "rejected" ? XCircle : CheckCircle2;

  return (
    <div className={`mt-4 rounded-ui border p-3 text-sm ${copy.tone}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <div className="font-semibold">{copy.title}</div>
          <div className="mt-1 leading-6">{copy.body}</div>
        </div>
      </div>
    </div>
  );
}

export function splitCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nextStepCopy(stage: ImportStage, selectedCount: number, batchStatus?: string | null) {
  if (stage === "start") {
    return {
      title: "Next: scan the skill root",
      body: "Use the repository root by leaving Skill Root empty, or paste a downloaded skills folder.",
      tone: "border-border bg-background text-muted"
    };
  }

  if (stage === "scanned") {
    return {
      title: "Next: create a review snapshot",
      body: "The scan is read-only. Create a review snapshot before selecting, editing evidence, or approving candidates.",
      tone: "border-accent/30 bg-accent/5 text-foreground"
    };
  }

  if (stage === "review") {
    return {
      title: selectedCount > 0 ? `Next: approve ${selectedCount} selected candidate${selectedCount === 1 ? "" : "s"}` : "Next: select pending candidates",
      body: "Review policy aliases and required evidence in the detail panel. Selected candidates become versioned registry records.",
      tone: "border-accent/30 bg-accent/5 text-foreground"
    };
  }

  if (stage === "rejected") {
    return {
      title: "Snapshot rejected",
      body: `Status: ${batchStatus ?? "rejected"}. Registry rows were not created from this snapshot.`,
      tone: "border-danger/30 bg-danger/10 text-danger"
    };
  }

  return {
    title: "Next: trigger or simulate the imported skill",
    body: "Use Risk Scanner for a dry policy check, or trigger the skill from Claude to create a governed run.",
    tone: "border-success/40 bg-success/10 text-foreground"
  };
}
