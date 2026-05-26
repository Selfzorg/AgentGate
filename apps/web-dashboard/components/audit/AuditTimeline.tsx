"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  getAuditEventsByTrace,
  getSkillRun,
  type AuditEventRecord,
  type SkillRunDetailResponse
} from "@/lib/api-client";

export function AuditTimeline({ traceId }: { traceId: string }) {
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [run, setRun] = useState<SkillRunDetailResponse["skill_run"] | null>(null);
  const [status, setStatus] = useState("Loading audit events...");

  const runId = useMemo(() => events.find((event) => event.skill_run_id)?.skill_run_id ?? null, [events]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await getAuditEventsByTrace(traceId);
        if (cancelled) return;
        setEvents(response.audit_events);
        setStatus(`${response.audit_events.length} audit events loaded.`);

        const linkedRunId = response.audit_events.find((event) => event.skill_run_id)?.skill_run_id;
        if (linkedRunId) {
          const detail = await getSkillRun(linkedRunId);
          if (!cancelled) setRun(detail.skill_run);
        }
      } catch {
        if (!cancelled) setStatus("Audit API unavailable. Start the Phase 3 dev server.");
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [traceId]);

  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Audit Timeline</h2>
          <p className="mt-1 text-sm text-muted">
            Trace ID: <span className="font-mono">{traceId}</span> · {status}
          </p>
        </div>
        {runId ? (
          <Link className="inline-flex items-center gap-2 text-sm text-accent" href={`/skill-runs/${runId}`}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open Skill Run
          </Link>
        ) : null}
      </div>

      {run ? (
        <div className="mt-5 grid gap-3 text-sm md:grid-cols-4">
          <SummaryTile label="Run Status" value={run.status} />
          <SummaryTile label="Decision" value={run.decision ?? "n/a"} />
          <SummaryTile label="Risk" value={run.risk_level ?? "n/a"} />
          <SummaryTile label="Execution Logs" value={String(run.execution_logs.length)} />
        </div>
      ) : null}

      {run ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div>
            <h3 className="text-sm font-semibold">Execution Evidence</h3>
            <div className="mt-2 overflow-hidden rounded-ui border border-border">
              {run.execution_logs.length === 0 ? (
                <div className="p-3 text-sm text-muted">No execution logs for this trace yet.</div>
              ) : (
                run.execution_logs.map((log) => (
                  <div key={log.id} className="border-b border-border px-3 py-2 text-sm last:border-b-0">
                    <span className="font-mono text-xs text-muted">[{log.sequence}]</span>{" "}
                    <span className="font-semibold">{log.level.toUpperCase()}</span> {log.message}
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Token + Attempts</h3>
            <div className="mt-2 overflow-hidden rounded-ui border border-border">
              <div className="border-b border-border px-3 py-2 text-sm">
                Tokens:{" "}
                {run.execution_tokens.length === 0
                  ? "none"
                  : run.execution_tokens.map((token) => `${token.id} (${token.status})`).join(", ")}
              </div>
              <div className="px-3 py-2 text-sm">
                Attempts:{" "}
                {run.attempts.length === 0
                  ? "none"
                  : run.attempts.map((attempt) => `${attempt.id} (${attempt.status})`).join(", ")}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ol className="mt-5 space-y-3">
        {events.length === 0 ? (
          <li className="text-sm text-muted">No events found for this trace yet.</li>
        ) : (
          events.map((event) => (
            <li key={event.id} className="grid gap-2 rounded-ui border border-border p-3 text-sm md:grid-cols-[120px_1fr]">
              <div className="font-mono text-xs text-muted">
                {new Date(event.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit"
                })}
              </div>
              <div>
                <div className="font-semibold">{event.event_type}</div>
                <div className="mt-1 text-xs text-muted">
                  actor {event.actor_type}
                  {event.actor_id ? `:${event.actor_id}` : ""} · sequence {event.sequence ?? "n/a"}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-accent">Metadata</summary>
                  <pre className="mt-2 max-h-52 overflow-auto rounded-ui bg-foreground p-3 text-[11px] leading-5 text-background">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                </details>
              </div>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-ui border border-border bg-background p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
