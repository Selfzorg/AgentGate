"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import {
  getDemoActions,
  replayDemoActionJson,
  type DecisionResponse,
  type DemoActionCard
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";

const decisionTone: Record<DemoActionCard["expected_decision"], string> = {
  ALLOW: "text-success",
  DENY: "text-danger",
  REQUIRE_APPROVAL: "text-warning",
  FORCE_DRY_RUN: "text-accent"
};

export function DemoActionLauncher() {
  const [actions, setActions] = useState<DemoActionCard[]>([]);
  const [status, setStatus] = useState("Loading fixture-backed demo actions...");
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<DecisionResponse | null>(null);

  useEffect(() => {
    void getDemoActions()
      .then((response) => {
        setActions(response.actions);
        setStatus("Fixture actions loaded from API.");
      })
      .catch(() => {
        setStatus("API unavailable. Start pnpm dev after migration and seed complete.");
      });
  }, []);

  async function handleReplay(actionId: string) {
    setPendingActionId(actionId);
    try {
      const response = await replayDemoActionJson(actionId);
      setLastDecision(response.decision);
      setStatus(
        `${response.decision.decision} for ${response.decision.skill_id}. Trace ${response.decision.trace_id}.`
      );
    } catch {
      setStatus("Replay failed. Check the API server and seed data.");
    } finally {
      setPendingActionId(null);
    }
  }

  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Demo Actions</h2>
        <p className="mt-1 text-sm text-muted">{status}</p>
      </div>
      <div className="space-y-3">
        {actions.map((action) => (
          <article key={action.id} className="rounded-ui border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">{action.label}</h3>
                <p className="mt-1 text-xs leading-5 text-muted">{action.description}</p>
              </div>
              <span className={`text-xs font-semibold ${decisionTone[action.expected_decision]}`}>
                {action.expected_decision}
              </span>
            </div>
            <Button
              className="mt-3 w-full"
              variant="secondary"
              onClick={() => void handleReplay(action.id)}
              disabled={pendingActionId === action.id}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {pendingActionId === action.id ? "Replaying..." : action.button_label}
            </Button>
          </article>
        ))}
      </div>
      {lastDecision ? (
        <div className="mt-4 rounded-ui border border-border bg-background p-3 text-xs leading-5">
          <div className={`font-semibold ${decisionTone[lastDecision.decision]}`}>
            {lastDecision.decision}
          </div>
          <div className="mt-1 text-muted">{lastDecision.reason}</div>
          <div className="mt-2 font-mono text-[11px] text-muted">
            run {lastDecision.run_id} · trace {lastDecision.trace_id}
          </div>
        </div>
      ) : null}
    </section>
  );
}
