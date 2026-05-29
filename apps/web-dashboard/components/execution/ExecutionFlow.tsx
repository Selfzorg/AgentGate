import { CheckCircle2, Circle, Clock3 } from "lucide-react";
import type { ExecutionTokenSummary, SkillRunDetailResponse } from "@/lib/api-client";

type SkillRun = SkillRunDetailResponse["skill_run"];

const steps = ["Approval", "Token", "Execute", "Complete"];

export function ExecutionStepRail({ run, token }: { run: SkillRun | null; token: ExecutionTokenSummary | null }) {
  const activeIndex = executionStepIndex(run, token);

  return (
    <div className="mt-4 grid gap-2 md:grid-cols-4">
      {steps.map((label, index) => {
        const isDone = run?.status === "completed" || index < activeIndex;
        const isActive = index === activeIndex && run?.status !== "completed";
        const Icon = isDone ? CheckCircle2 : isActive ? Clock3 : Circle;

        return (
          <div
            key={label}
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
                {index + 1}. {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ExecutionNextStep({
  run,
  token,
  isClaudeImportedRun,
  canContinueInClaude,
  claudeHandoffDisabledReason
}: {
  run: SkillRun | null;
  token: ExecutionTokenSummary | null;
  isClaudeImportedRun: boolean;
  canContinueInClaude: boolean;
  claudeHandoffDisabledReason: string | null;
}) {
  const copy = executionNextStepCopy({
    run,
    token,
    isClaudeImportedRun,
    canContinueInClaude,
    claudeHandoffDisabledReason
  });

  return (
    <div className={`mt-4 rounded-ui border p-3 text-sm ${copy.tone}`}>
      <div className="font-semibold">{copy.title}</div>
      <p className="mt-1 leading-6">{copy.body}</p>
      {copy.command ? <pre className="mt-3 overflow-auto rounded-ui bg-foreground p-3 text-xs text-background">{copy.command}</pre> : null}
    </div>
  );
}

function executionStepIndex(run: SkillRun | null, token: ExecutionTokenSummary | null) {
  if (!run) return 0;
  if (run.status === "completed" || run.status === "failed") return 3;
  if (run.status === "executing" || run.status === "execution_queued") return 2;
  if (token || run.status === "credential_issued" || run.status === "approved" || run.status === "policy_evaluated") return 1;
  return 0;
}

function executionNextStepCopy(input: {
  run: SkillRun | null;
  token: ExecutionTokenSummary | null;
  isClaudeImportedRun: boolean;
  canContinueInClaude: boolean;
  claudeHandoffDisabledReason: string | null;
}) {
  if (!input.run) {
    return {
      title: "Loading run state",
      body: "The console is fetching approval, token, and execution state.",
      tone: "border-border bg-background text-muted"
    };
  }

  if (input.run.status === "completed") {
    return {
      title: "Execution complete",
      body: "Logs and audit events are persisted. Open the audit trace for final verification.",
      tone: "border-success/40 bg-success/10 text-foreground"
    };
  }

  if (input.run.status === "failed") {
    return {
      title: "Execution failed",
      body: "Use the logs and audit trace to inspect failure details before retrying.",
      tone: "border-danger/30 bg-danger/10 text-danger"
    };
  }

  if (input.run.approval_request && input.run.approval_request.status !== "approved") {
    return {
      title: "Next: finish approval",
      body: "This run still needs a ready, approved approval packet before execution can continue.",
      tone: "border-warning/30 bg-warning/10 text-warning"
    };
  }

  if (input.isClaudeImportedRun && input.run.status === "executing") {
    return {
      title: "Next: Claude completion callback",
      body: "Claude has received the approved skill body. After local execution, it must mark this run completed or failed.",
      command: `pnpm exec agentgate claude complete --run-id ${input.run.id} --status completed`,
      tone: "border-accent/30 bg-accent/5 text-foreground"
    };
  }

  if (input.isClaudeImportedRun && input.canContinueInClaude) {
    return {
      title: "Next: continue in Claude",
      body: "Generate the one-time Claude command. Claude verifies the run and token, receives the approved skill body, executes it, then calls completion.",
      tone: "border-accent/30 bg-accent/5 text-foreground"
    };
  }

  if (input.isClaudeImportedRun) {
    return {
      title: "Claude handoff unavailable",
      body: input.claudeHandoffDisabledReason ?? "The run is not ready for Claude handoff.",
      tone: "border-warning/30 bg-warning/10 text-warning"
    };
  }

  if (!input.token) {
    return {
      title: "Next: issue execution token",
      body: "Create the scoped, expiring token before queueing a non-Claude connector execution.",
      tone: "border-accent/30 bg-accent/5 text-foreground"
    };
  }

  return {
    title: "Next: execute through AgentGate",
    body: "Queue the approved connector execution. The DB-backed runner will claim it, stream logs, and finalize audit.",
    tone: "border-accent/30 bg-accent/5 text-foreground"
  };
}
