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
          Execution Token: unavailable in Phase 0
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
        {`[phase-0] execution_logs table exists after migration\n[phase-0] SSE endpoint shell is reserved\n[phase-0] runner loop starts with the API process`}
      </pre>
    </section>
  );
}
