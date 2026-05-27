"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, Search, ShieldAlert } from "lucide-react";
import {
  getRiskScannerSamples,
  simulateRisk,
  type DecisionResponse,
  type RiskScannerSample,
  type RiskScannerSimulation
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";

const decisionTone: Record<DecisionResponse["decision"], string> = {
  ALLOW: "border-success/30 bg-success/10 text-success",
  DENY: "border-danger/30 bg-danger/10 text-danger",
  REQUIRE_APPROVAL: "border-warning/30 bg-warning/10 text-warning",
  FORCE_DRY_RUN: "border-accent/30 bg-accent/10 text-accent"
};

const riskTone: Record<RiskScannerSimulation["risk"]["level"], string> = {
  low: "text-success",
  medium: "text-accent",
  high: "text-warning",
  critical: "text-danger"
};

export function RiskScannerPanel() {
  const [samples, setSamples] = useState<RiskScannerSample[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payloadText, setPayloadText] = useState("");
  const [simulation, setSimulation] = useState<RiskScannerSimulation | null>(null);
  const [status, setStatus] = useState("Loading samples...");
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
      })
      .catch(() => setStatus("API unavailable"));
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
    } catch {
      setStatus("Simulation failed");
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
              <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${decisionTone[sample.expected_decision]}`}>
                {sample.expected_decision}
              </span>
            </button>
          ))}
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
  const Icon = simulation.decision === "ALLOW" ? CheckCircle2 : simulation.decision === "DENY" ? ShieldAlert : AlertTriangle;

  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Preview</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{simulation.explanation}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${decisionTone[simulation.decision]}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
          {simulation.decision}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-ui border border-border bg-background p-4">
          <div className="text-xs uppercase text-muted">Resolved Skill</div>
          <div className="mt-2 text-sm font-semibold">{simulation.resolved_skill.name}</div>
          <div className="mt-1 font-mono text-xs text-muted">{simulation.resolved_skill.skill_id}</div>
        </div>
        <div className="rounded-ui border border-border bg-background p-4">
          <div className="text-xs uppercase text-muted">Risk</div>
          <div className={`mt-2 text-sm font-semibold ${riskTone[simulation.risk.level]}`}>
            {simulation.risk.level} · {simulation.risk.score}
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
                  <span className={check.status === "passed" ? "text-success" : "text-warning"}>{check.status}</span>
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
