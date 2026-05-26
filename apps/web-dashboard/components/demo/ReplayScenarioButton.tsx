"use client";

import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReplayScenarioButton() {
  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <h2 className="text-base font-semibold">Replay Scenario</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        The full deterministic scenario is reserved for later phases after the decision and approval lifecycle exists.
      </p>
      <Button className="mt-4 w-full" variant="accent" disabled>
        <GitBranch className="h-4 w-4" aria-hidden="true" />
        Replay Scenario
      </Button>
    </section>
  );
}
