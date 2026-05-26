"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import { replayDemoScenario, type DemoScenarioReplayResponse } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function ReplayScenarioButton() {
  const [scenario, setScenario] = useState<DemoScenarioReplayResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReplay() {
    setPending(true);
    setError(null);
    try {
      setScenario(await replayDemoScenario());
    } catch {
      setError("Scenario replay failed. Check the API server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <h2 className="text-base font-semibold">Replay Scenario</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        Phase 1 replays the deterministic fixture set through resolver, risk, policy, persistence, and audit.
      </p>
      <Button className="mt-4 w-full" variant="accent" onClick={() => void handleReplay()} disabled={pending}>
        <GitBranch className="h-4 w-4" aria-hidden="true" />
        {pending ? "Replaying..." : "Replay Scenario"}
      </Button>
      {scenario ? (
        <div className="mt-4 rounded-ui border border-border bg-background p-3 text-xs leading-5 text-muted">
          {scenario.decisions.length} decisions persisted. Last trace{" "}
          <span className="font-mono">{scenario.decisions.at(-1)?.decision.trace_id}</span>.
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
