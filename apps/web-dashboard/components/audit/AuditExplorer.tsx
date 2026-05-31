"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { getAuditTraces, type AuditTraceRecord } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

export function AuditExplorer() {
  const [traces, setTraces] = useState<AuditTraceRecord[]>([]);
  const [filters, setFilters] = useState({
    q: "",
    run_id: "",
    trace_id: "",
    event_type: ""
  });
  const [status, setStatus] = useState("Loading recent audit traces...");
  const [loading, setLoading] = useState(true);

  async function loadTraces(nextFilters = filters) {
    setLoading(true);
    try {
      const response = await getAuditTraces({ limit: 50, ...cleanFilters(nextFilters) });
      setTraces(response.audit_traces);
      setStatus(`Showing ${response.audit_traces.length} grouped traces with lifecycle checks.`);
    } catch {
      setStatus("Audit API unavailable. Start the AgentGate dev server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTraces();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadTraces(filters);
  }

  function clearFilters() {
    const empty = { q: "", run_id: "", trace_id: "", event_type: "" };
    setFilters(empty);
    void loadTraces(empty);
  }

  return (
    <div className="space-y-5">
      <form className="rounded-ui border border-border bg-surface p-4 shadow-panel" onSubmit={handleSubmit}>
        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto_auto]">
          <TextFilter
            label="Search audit"
            value={filters.q}
            placeholder="Trace, run, event type, actor, action"
            onChange={(q) => setFilters((current) => ({ ...current, q }))}
          />
          <TextFilter label="Run ID" value={filters.run_id} placeholder="run_..." onChange={(run_id) => setFilters((current) => ({ ...current, run_id }))} />
          <TextFilter label="Trace ID" value={filters.trace_id} placeholder="trc_..." onChange={(trace_id) => setFilters((current) => ({ ...current, trace_id }))} />
          <TextFilter
            label="Event Type"
            value={filters.event_type}
            placeholder="approval.granted"
            onChange={(event_type) => setFilters((current) => ({ ...current, event_type }))}
          />
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
            <h2 className="text-base font-semibold">Recent Trace Groups</h2>
            <p className="mt-1 text-sm text-muted">{status}</p>
          </div>
          <Button variant="secondary" disabled={loading} onClick={() => void loadTraces()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="grid divide-y divide-border">
          {traces.length === 0 ? (
            <div className="p-6 text-sm text-muted">No audit traces match the current filters.</div>
          ) : (
            traces.map((trace) => <TraceRow key={trace.trace_id} trace={trace} />)
          )}
        </div>
      </section>
    </div>
  );
}

function TraceRow({ trace }: { trace: AuditTraceRecord }) {
  const missing = trace.lifecycle.missing_events.length;

  return (
    <article className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_260px_220px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <a className="font-mono text-sm font-medium text-accent" href={`/audit/${trace.trace_id}`}>
            {trace.trace_id}
          </a>
          <StatusBadge kind="audit" value={trace.lifecycle.complete ? "complete" : "incomplete"} />
          {trace.run?.status ? <StatusBadge kind="run" value={trace.run.status} /> : null}
          {trace.run?.decision ? <StatusBadge kind="decision" value={trace.run.decision} /> : null}
        </div>
        <p className="mt-2 truncate font-mono text-xs text-muted">{trace.run?.raw_action ?? "No linked run action."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {trace.event_types.slice(0, 6).map((eventType) => (
            <span key={eventType} className="rounded-ui border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted">
              {eventType}
            </span>
          ))}
          {trace.event_types.length > 6 ? <span className="px-1 py-1 text-xs text-muted">+{trace.event_types.length - 6}</span> : null}
        </div>
      </div>

      <div className="text-sm">
        <div className="text-xs uppercase text-muted">Lifecycle</div>
        <div className="mt-2 font-medium">{trace.lifecycle.complete ? "Complete trace" : `${missing} missing event${missing === 1 ? "" : "s"}`}</div>
        <div className="mt-1 text-xs leading-5 text-muted">
          {trace.lifecycle.complete ? `${trace.event_count} ordered event${trace.event_count === 1 ? "" : "s"}.` : trace.lifecycle.missing_events.slice(0, 3).join(", ")}
        </div>
      </div>

      <div className="flex flex-col items-start gap-2">
        {trace.skill_run_id ? <IndexLink href={`/skill-runs/${trace.skill_run_id}`} label="Open Run" /> : null}
        <IndexLink href={`/audit/${trace.trace_id}`} label="Open Trace" />
        {trace.skill_run_id ? <IndexLink href={`/evidence?run_id=${encodeURIComponent(trace.skill_run_id)}`} label="Evidence" /> : null}
        {trace.skill_run_id ? <IndexLink href={`/skill-runs/${trace.skill_run_id}#execution-logs`} label="Logs" /> : null}
        <div className="mt-1 font-mono text-[11px] text-muted">{trace.latest_event?.event_type ?? "no events"} at {trace.latest_event_at ? formatDateTime(trace.latest_event_at) : "n/a"}</div>
      </div>
    </article>
  );
}

function TextFilter({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        suppressHydrationWarning
        className="mt-2 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
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
