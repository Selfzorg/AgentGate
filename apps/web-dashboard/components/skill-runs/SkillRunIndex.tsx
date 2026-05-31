"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { getSkillRuns, type SkillRunListRecord } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const statusOptions = [
  "",
  "approval_required",
  "approval_pending",
  "approved",
  "credential_issued",
  "execution_queued",
  "executing",
  "completed",
  "failed",
  "denied"
];

const decisionOptions = ["", "ALLOW", "REQUIRE_APPROVAL", "FORCE_DRY_RUN", "DENY"];
const riskOptions = ["", "low", "medium", "high", "critical"];
const environmentOptions = ["", "dev", "staging", "production"];

export function SkillRunIndex() {
  const [runs, setRuns] = useState<SkillRunListRecord[]>([]);
  const [filters, setFilters] = useState({
    q: "",
    status: "",
    decision: "",
    risk_level: "",
    environment: "",
    skill_id: "",
    trace_id: ""
  });
  const [status, setStatus] = useState("Loading latest skill runs...");
  const [loading, setLoading] = useState(true);

  async function loadRuns(nextFilters = filters) {
    setLoading(true);
    try {
      const response = await getSkillRuns({ limit: 100, ...cleanFilters(nextFilters) });
      setRuns(response.skill_runs);
      const searchText = Object.values(cleanFilters(nextFilters)).length ? "matching " : "";
      setStatus(`Showing ${response.skill_runs.length} ${searchText}skill runs from the latest bounded index.`);
    } catch {
      setStatus("Skill run API unavailable. Start the AgentGate dev server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadRuns(filters);
  }

  function clearFilters() {
    const empty = {
      q: "",
      status: "",
      decision: "",
      risk_level: "",
      environment: "",
      skill_id: "",
      trace_id: ""
    };
    setFilters(empty);
    void loadRuns(empty);
  }

  return (
    <div className="space-y-5">
      <form className="rounded-ui border border-border bg-surface p-4 shadow-panel" onSubmit={handleSubmit}>
        <div className="grid gap-3 lg:grid-cols-[1.5fr_repeat(4,minmax(130px,1fr))]">
          <label className="text-sm font-medium">
            Search runs
            <input
              suppressHydrationWarning
              className="mt-2 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder="Run ID, trace ID, action, skill, status"
            />
          </label>
          <SelectFilter label="Status" value={filters.status} options={statusOptions} onChange={(status) => setFilters((current) => ({ ...current, status }))} />
          <SelectFilter label="Decision" value={filters.decision} options={decisionOptions} onChange={(decision) => setFilters((current) => ({ ...current, decision }))} />
          <SelectFilter label="Risk" value={filters.risk_level} options={riskOptions} onChange={(risk_level) => setFilters((current) => ({ ...current, risk_level }))} />
          <SelectFilter label="Environment" value={filters.environment} options={environmentOptions} onChange={(environment) => setFilters((current) => ({ ...current, environment }))} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <label className="text-sm font-medium">
            Skill
            <input
              suppressHydrationWarning
              className="mt-2 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              value={filters.skill_id}
              onChange={(event) => setFilters((current) => ({ ...current, skill_id: event.target.value }))}
              placeholder="deploy-production"
            />
          </label>
          <label className="text-sm font-medium">
            Trace
            <input
              suppressHydrationWarning
              className="mt-2 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              value={filters.trace_id}
              onChange={(event) => setFilters((current) => ({ ...current, trace_id: event.target.value }))}
              placeholder="trc_..."
            />
          </label>
          <Button className="self-end" type="submit" variant="primary" disabled={loading}>
            <Search className="h-4 w-4" aria-hidden="true" />
            Search
          </Button>
          <Button className="self-end" type="button" variant="ghost" disabled={loading} onClick={clearFilters}>
            <X className="h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </form>

      <section className="overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold">Latest 100 Runs</h2>
            <p className="mt-1 text-sm text-muted">{status}</p>
          </div>
          <Button variant="secondary" disabled={loading} onClick={() => void loadRuns()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
            <thead className="bg-background text-xs uppercase text-muted">
              <tr>
                {["Run", "Action", "Skill", "State", "Evidence", "Next", "Links"].map((column) => (
                  <th key={column} className="border-b border-border px-4 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-muted" colSpan={7}>
                    No skill runs match the current filters. Replay a governed action or clear the search.
                  </td>
                </tr>
              ) : (
                runs.map((run) => <RunRow key={run.id} run={run} />)
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RunRow({ run }: { run: SkillRunListRecord }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-white/[0.03]">
      <td className="px-4 py-4 align-top">
        <a className="font-mono text-xs text-accent" href={`/skill-runs/${run.id}`}>
          {run.id}
        </a>
        <div className="mt-1 font-mono text-[11px] text-muted">{run.trace_id}</div>
        <div className="mt-2 text-xs text-muted">{formatDateTime(run.created_at)}</div>
      </td>
      <td className="max-w-[300px] px-4 py-4 align-top">
        <div className="truncate font-mono text-xs">{run.raw_action}</div>
        <div className="mt-2 text-xs leading-5 text-muted">{run.reason ?? "No reason recorded."}</div>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="font-medium">{run.skill_id ?? "unresolved"}</div>
        <div className="mt-1 text-xs text-muted">{run.environment ?? "n/a"}</div>
        {run.matched_policy_id ? <div className="mt-1 font-mono text-[11px] text-muted">{run.matched_policy_id}</div> : null}
      </td>
      <td className="px-4 py-4 align-top">
        <div className="flex flex-wrap gap-2">
          <StatusBadge kind="run" value={run.status} />
          {run.decision ? <StatusBadge kind="decision" value={run.decision} /> : null}
          {run.risk_level ? <StatusBadge kind="risk" value={run.risk_level} /> : null}
        </div>
        {run.approval ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge kind="approval" value={run.approval.status} />
            <StatusBadge kind="approval" value={run.approval.approval_readiness} label={`readiness ${run.approval.approval_readiness}`} />
          </div>
        ) : null}
      </td>
      <td className="px-4 py-4 align-top">
        <div className="grid grid-cols-2 gap-1 font-mono text-[11px] text-muted">
          <span>checks {run.counts.gate_checks}</span>
          <span>evidence {run.counts.evidence_tasks}</span>
          <span>logs {run.counts.execution_logs}</span>
          <span>audit {run.counts.audit_events}</span>
        </div>
        {run.no_gate_check_reason ? <div className="mt-2 max-w-[260px] text-xs leading-5 text-warning">{run.no_gate_check_reason}</div> : null}
      </td>
      <td className="px-4 py-4 align-top">
        <div className="font-medium">{run.next_action}</div>
        {run.latest_audit_event ? (
          <div className="mt-2 font-mono text-[11px] text-muted">
            {run.latest_audit_event.event_type} #{run.latest_audit_event.sequence ?? "n/a"}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-4 align-top">
        <div className="flex flex-col items-start gap-2">
          <IndexLink href={`/skill-runs/${run.id}`} label="Open Run" />
          <IndexLink href={`/evidence?run_id=${encodeURIComponent(run.id)}`} label="Evidence" />
          <IndexLink href={`/audit/${run.trace_id}`} label="Audit" />
          <IndexLink href={`/approvals?q=${encodeURIComponent(run.id)}`} label="Approval" />
          <IndexLink href={`/skill-runs/${run.id}#execution-logs`} label="Logs" />
        </div>
      </td>
    </tr>
  );
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        suppressHydrationWarning
        className="mt-2 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option || "all"} value={option}>
            {option || "all"}
          </option>
        ))}
      </select>
    </label>
  );
}

function IndexLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-foreground" href={href}>
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </a>
  );
}

function cleanFilters(filters: Record<string, string>) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim().length > 0));
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
