"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Search } from "lucide-react";
import {
  getRiskScannerSamples,
  simulateRisk,
  type RiskScannerSample,
  type RiskScannerSimulation
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

export function RiskScannerPanel() {
  const [samples, setSamples] = useState<RiskScannerSample[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payloadText, setPayloadText] = useState("");
  const [simulation, setSimulation] = useState<RiskScannerSimulation | null>(null);
  const [status, setStatus] = useState("Loading samples...");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [isSimulating, setIsSimulating] = useState(false);

  const selectedSample = useMemo(
    () => samples.find((sample) => sample.id === selectedId) ?? null,
    [samples, selectedId]
  );

  useEffect(() => {
    void getRiskScannerSamples()
      .then((response) => {
        setSamples(response.samples);
        const first = response.samples[0];
        if (first) {
          setSelectedId(first.id);
          setPayloadText(JSON.stringify(first.payload, null, 2));
        }
        setStatus("Ready");
        setLoadState("ready");
      })
      .catch(() => {
        setStatus("API unavailable");
        setLoadState("error");
      });
  }, []);

  function loadSample(sample: RiskScannerSample) {
    setSelectedId(sample.id);
    setPayloadText(JSON.stringify(sample.payload, null, 2));
    setSimulation(null);
    setStatus("Ready");
  }

  async function runSimulation() {
    setIsSimulating(true);
    try {
      const payload = JSON.parse(payloadText) as Record<string, unknown>;
      const result = await simulateRisk(payload);
      setSimulation(result);
      setStatus(result.decision);
    } catch (error) {
      setStatus(error instanceof SyntaxError ? "Payload JSON is invalid" : "Simulation failed");
    } finally {
      setIsSimulating(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Samples</h2>
            <p className="mt-1 text-xs text-muted">{status}</p>
          </div>
          <Search className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          {samples.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => loadSample(sample)}
              className={`w-full rounded-ui border p-3 text-left transition-colors ${
                selectedSample?.id === sample.id
                  ? "border-foreground bg-background text-foreground"
                  : "border-border text-muted hover:border-muted hover:bg-background"
              }`}
            >
              <span className="block text-sm font-medium">{sample.label}</span>
              <span className="mt-1 block text-xs leading-5">{sample.description}</span>
              <StatusBadge className="mt-2" kind="decision" value={sample.expected_decision} />
            </button>
          ))}
          {loadState === "loading" ? (
            <div className="rounded-ui border border-dashed border-border p-3 text-sm text-muted">
              Loading samples from configs/demo-actions.yaml through the API...
            </div>
          ) : null}
          {loadState === "ready" && samples.length === 0 ? (
            <div className="rounded-ui border border-dashed border-border p-3 text-sm text-muted">
              No scanner samples returned. Rerun the seed command.
            </div>
          ) : null}
          {loadState === "error" ? (
            <div className="rounded-ui border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              API unavailable. Start the API server and refresh this page.
            </div>
          ) : null}
        </div>
      </section>

      <div className="space-y-5">
        <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Payload</h2>
            <Button onClick={() => void runSimulation()} disabled={isSimulating || payloadText.trim().length === 0}>
              {isSimulating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              )}
              Simulate
            </Button>
          </div>
          <textarea
            value={payloadText}
            onChange={(event) => setPayloadText(event.target.value)}
            spellCheck={false}
            className="min-h-[280px] w-full resize-y rounded-ui border border-border bg-background p-4 font-mono text-xs leading-5 text-foreground outline-none focus:border-accent"
          />
        </section>

        {simulation ? <SimulationResult simulation={simulation} /> : null}
      </div>
    </div>
  );
}

function SimulationResult({ simulation }: { simulation: RiskScannerSimulation }) {
  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Preview</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{simulation.explanation}</p>
        </div>
        <StatusBadge kind="decision" value={simulation.decision} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-ui border border-border bg-background p-4">
          <div className="text-xs uppercase text-muted">Resolved Skill</div>
          <div className="mt-2 text-sm font-semibold">{simulation.resolved_skill.name}</div>
          <div className="mt-1 font-mono text-xs text-muted">{simulation.resolved_skill.skill_id}</div>
        </div>
        <div className="rounded-ui border border-border bg-background p-4">
          <div className="text-xs uppercase text-muted">Risk</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge kind="risk" value={simulation.risk.level} />
            <span className="text-sm font-semibold">{simulation.risk.score}</span>
          </div>
          <div className="mt-1 text-xs text-muted">{simulation.risk.reasons[0]}</div>
        </div>
        <div className="rounded-ui border border-border bg-background p-4">
          <div className="text-xs uppercase text-muted">Policy</div>
          <div className="mt-2 text-sm font-semibold">
            {simulation.matched_policy?.name ?? "Default risk fallback"}
          </div>
          <div className="mt-1 font-mono text-xs text-muted">
            {simulation.matched_policy?.policy_id ?? simulation.precedence}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-ui border border-border bg-background p-4">
          <h3 className="text-sm font-semibold">Checks</h3>
          <div className="mt-3 space-y-2">
            {simulation.gate_checks.length > 0 ? (
              simulation.gate_checks.map((check) => (
                <div key={check.check_key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{check.label}</span>
                  <StatusBadge kind="gate" value={check.status} />
                </div>
              ))
            ) : (
              <div className="text-sm text-muted">No gate checks</div>
            )}
          </div>
        </div>
        <div className="rounded-ui border border-border bg-background p-4">
          <h3 className="text-sm font-semibold">Side Effects</h3>
          <div className="mt-3 grid gap-2 text-sm">
            {Object.entries(simulation.side_effects).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="capitalize text-muted">{key.replaceAll("_", " ")}</span>
                <span className={value ? "text-danger" : "text-success"}>{value ? "yes" : "no"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
