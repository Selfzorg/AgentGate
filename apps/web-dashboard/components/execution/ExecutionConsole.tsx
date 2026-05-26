import { KeyRound, Radio, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExecutionConsole({ runId }: { runId: string }) {
  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold">Execution Console</h2>
          <p className="mt-1 text-sm text-muted">Run ID: {runId}</p>
        </div>
        <span className="rounded-ui bg-background px-2 py-1 text-xs text-muted">
          Execution Token: unavailable until Phase 3
        </span>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" disabled>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Issue Execution Token
        </Button>
        <Button variant="secondary" disabled>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Execute Through AgentGate
        </Button>
        <Button variant="secondary" disabled>
          <Radio className="h-4 w-4" aria-hidden="true" />
          Open Live Logs
        </Button>
      </div>
      <pre className="mt-5 overflow-x-auto rounded-ui bg-foreground p-4 text-xs leading-6 text-background">
        {`[phase-1] decision records exist in skill_runs\n[phase-1] audit_events capture resolver, risk, and policy\n[phase-3] execution_logs and SSE console come next`}
      </pre>
    </section>
  );
}
