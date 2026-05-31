"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Loader2, RefreshCw, Search, Wand2 } from "lucide-react";
import {
  getSkills,
  getRiskScannerSamples,
  simulateRisk,
  type SkillRecord,
  type RiskScannerSample,
  type RiskScannerSimulation
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildSkillSimulationPayload,
  defaultEnvironmentFor,
  defaultRawActionForSkill,
  isImportedSkill,
  isSkillCompatibleWithSource,
  sourceTypeForSkill,
  type SimulationEnvironment,
  type SimulationPolicyMode,
  type SimulationSource
} from "./payload-builder";

export function RiskScannerPanel() {
  const [samples, setSamples] = useState<RiskScannerSample[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payloadText, setPayloadText] = useState("");
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [simulationSource, setSimulationSource] = useState<SimulationSource>("claude-code");
  const [environment, setEnvironment] = useState<SimulationEnvironment>("production");
  const [policyMode, setPolicyMode] = useState<SimulationPolicyMode>("enforce");
  const [rawAction, setRawAction] = useState("");
  const [simulation, setSimulation] = useState<RiskScannerSimulation | null>(null);
  const [status, setStatus] = useState("Loading samples...");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [skillLoadState, setSkillLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [isSimulating, setIsSimulating] = useState(false);

  const selectedSample = useMemo(
    () => samples.find((sample) => sample.id === selectedId) ?? null,
    [samples, selectedId]
  );
  const importedSkills = useMemo(
    () => skills.filter((skill) => skill.status === "active" && skill.version_status === "active" && isImportedSkill(skill)),
    [skills]
  );
  const compatibleSkills = useMemo(
    () => importedSkills.filter((skill) => isSkillCompatibleWithSource(skill, simulationSource)),
    [importedSkills, simulationSource]
  );
  const selectedSkill = useMemo(
    () => compatibleSkills.find((skill) => skill.id === selectedSkillId) ?? compatibleSkills[0] ?? null,
    [compatibleSkills, selectedSkillId]
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
    void loadImportedSkills();
  }, []);

  useEffect(() => {
    const first = compatibleSkills[0];
    if (!first) {
      setSelectedSkillId("");
      setRawAction("");
      return;
    }
    const nextSkill = compatibleSkills.some((skill) => skill.id === selectedSkillId) ? selectedSkill : first;
    if (nextSkill && nextSkill.id !== selectedSkillId) setSelectedSkillId(nextSkill.id);
    if (nextSkill) {
      setEnvironment(defaultEnvironmentFor(nextSkill));
      setRawAction(defaultRawActionForSkill(nextSkill));
    }
  }, [compatibleSkills, selectedSkill, selectedSkillId]);

  function loadSample(sample: RiskScannerSample) {
    setSelectedId(sample.id);
    setPayloadText(JSON.stringify(sample.payload, null, 2));
    setSimulation(null);
    setStatus("Ready");
  }

  async function loadImportedSkills() {
    setSkillLoadState("loading");
    try {
      const response = await getSkills();
      setSkills(response.skills);
      setSkillLoadState("ready");
    } catch {
      setSkillLoadState("error");
    }
  }

  function loadSkillPayload() {
    if (!selectedSkill) {
      setStatus("No active imported skill for this source.");
      return;
    }
    setSelectedId(null);
    setSimulation(null);
    setPayloadText(
      JSON.stringify(
        buildSkillSimulationPayload({
          skill: selectedSkill,
          source: simulationSource,
          environment,
          policyMode,
          rawAction
        }),
        null,
        2
      )
    );
    setStatus(`Payload built from ${selectedSkill.name}. Next: simulate policy.`);
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
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Approved Skills</h2>
              <p className="mt-1 text-xs text-muted">
                {skillLoadState === "ready" ? `${compatibleSkills.length} available` : skillLoadState === "loading" ? "Loading" : "Unavailable"}
              </p>
            </div>
            <Button variant="ghost" onClick={() => void loadImportedSkills()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="grid gap-3">
            <label>
              <span className="text-xs font-semibold uppercase text-muted">Source</span>
              <select
                value={simulationSource}
                onChange={(event) => setSimulationSource(event.target.value as SimulationSource)}
                className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
              >
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="mcp_proxy">MCP Proxy</option>
              </select>
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-muted">Skill</span>
              <select
                value={selectedSkill?.id ?? ""}
                onChange={(event) => {
                  const skill = compatibleSkills.find((candidate) => candidate.id === event.target.value) ?? null;
                  setSelectedSkillId(event.target.value);
                  if (skill) {
                    setEnvironment(defaultEnvironmentFor(skill));
                    setRawAction(defaultRawActionForSkill(skill));
                  }
                }}
                disabled={compatibleSkills.length === 0}
                className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent disabled:text-muted"
              >
                {compatibleSkills.length === 0 ? <option value="">No active imported skills</option> : null}
                {compatibleSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedSkill ? (
              <div className="flex flex-wrap gap-2">
                <StatusBadge kind="risk" value={selectedSkill.default_risk_level} />
                <StatusBadge kind="gate" value={sourceTypeForSkill(selectedSkill) ?? "imported"} />
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Environment</span>
                <select
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value as SimulationEnvironment)}
                  className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                >
                  <option value="dev">Dev</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Mode</span>
                <select
                  value={policyMode}
                  onChange={(event) => setPolicyMode(event.target.value as SimulationPolicyMode)}
                  className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                >
                  <option value="enforce">Enforce</option>
                  <option value="warn">Warn</option>
                  <option value="observe">Observe</option>
                </select>
              </label>
            </div>
            <label>
              <span className="text-xs font-semibold uppercase text-muted">Action</span>
              <input
                suppressHydrationWarning
                value={rawAction}
                onChange={(event) => setRawAction(event.target.value)}
                className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              />
            </label>
            <Button disabled={!selectedSkill} onClick={loadSkillPayload}>
              <Wand2 className="h-4 w-4" aria-hidden="true" />
              Build Simulation Payload
            </Button>
          </div>
        </div>
      </section>

      <div className="space-y-5">
        <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Simulation Payload</h2>
              <p className="mt-1 text-xs text-muted">Edit JSON if needed, then run a no-side-effect policy simulation.</p>
            </div>
            <Button onClick={() => void runSimulation()} disabled={isSimulating || payloadText.trim().length === 0}>
              {isSimulating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              )}
              Simulate Policy
            </Button>
          </div>
          <textarea
            suppressHydrationWarning
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
  const importedSelection = simulation.registry_resolution.imported_selected;

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

      {importedSelection ? (
        <div className="mt-5 rounded-ui border border-border bg-background p-4">
          <div className="text-xs uppercase text-muted">Imported Registry Match</div>
          <div className="mt-2 text-sm font-semibold">{importedSelection.name}</div>
          <div className="mt-1 font-mono text-xs text-muted">{importedSelection.skill_id}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge kind="gate" value={importedSelection.source_type} />
            <StatusBadge kind="risk" value={importedSelection.default_risk_level} />
            <span className="rounded-ui border border-border px-2 py-1 font-mono text-xs text-muted">
              {importedSelection.confidence.toFixed(2)} via {importedSelection.matched_field}
            </span>
          </div>
        </div>
      ) : null}

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
