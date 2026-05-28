"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import {
  getAuditIntegrityByTrace,
  getAuditEventsByTrace,
  getSkillRun,
  type AuditIntegrityRecord,
  type AuditEventRecord,
  type SkillRunDetailResponse
} from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/status-badge";

export function AuditTimeline({ traceId }: { traceId: string }) {
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [integrity, setIntegrity] = useState<AuditIntegrityRecord | null>(null);
  const [run, setRun] = useState<SkillRunDetailResponse["skill_run"] | null>(null);
  const [status, setStatus] = useState("Loading audit events...");

  const runId = useMemo(() => events.find((event) => event.skill_run_id)?.skill_run_id ?? null, [events]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [response, integrityResponse] = await Promise.all([
          getAuditEventsByTrace(traceId),
          getAuditIntegrityByTrace(traceId)
        ]);
        if (cancelled) return;
        setEvents(response.audit_events);
        setIntegrity(integrityResponse.audit_integrity);
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
          <div className="flex flex-wrap items-center gap-2">
            {integrity ? (
              <StatusBadge kind="audit" value={integrity.complete ? "complete" : "incomplete"} />
            ) : null}
            <Link className="inline-flex items-center gap-2 text-sm text-accent" href={`/skill-runs/${runId}`}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open Skill Run
            </Link>
          </div>
        ) : null}
      </div>

      {run ? (
        <div className="mt-5 grid gap-3 text-sm md:grid-cols-4">
          <SummaryTile label="Run Status" badge={<StatusBadge kind="run" value={run.status} />} />
          <SummaryTile label="Decision" badge={<StatusBadge kind="decision" value={run.decision} />} />
          <SummaryTile label="Risk" badge={<StatusBadge kind="risk" value={run.risk_level} />} />
          <SummaryTile label="Execution Logs" value={String(run.execution_logs.length)} />
        </div>
      ) : null}

      {integrity ? (
        <div
          className={`mt-5 rounded-ui border p-4 text-sm ${
            integrity.complete
              ? "border-success/30 bg-success/10 text-success"
              : "border-warning/30 bg-warning/10 text-warning"
          }`}
        >
          <div className="flex items-start gap-3">
            {integrity.complete ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
            )}
            <div>
              <div className="font-semibold">
                Audit trace {integrity.complete ? "complete" : "incomplete"}
              </div>
              <div className="mt-1 text-xs">
                {integrity.complete
                  ? `${integrity.observed_events.length} lifecycle events observed with ordered sequences.`
                  : `Missing ${integrity.missing_events.length} event(s); ${integrity.sequence.issues.length} sequence issue(s).`}
              </div>
              {!integrity.complete ? (
                <div className="mt-2 font-mono text-xs">
                  {[...integrity.missing_events, ...integrity.sequence.issues].join(" · ")}
                </div>
              ) : null}
            </div>
          </div>
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
                  : run.execution_tokens.map((token) => (
                      <span key={token.id} className="mr-2 inline-flex items-center gap-2">
                        <span className="font-mono text-xs text-muted">{token.id}</span>
                        <StatusBadge kind="token" value={token.status} />
                      </span>
                    ))}
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

function SummaryTile({ label, value, badge }: { label: string; value?: string; badge?: ReactNode }) {
  return (
    <div className="rounded-ui border border-border bg-background p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-2 font-semibold">{badge ?? value}</div>
    </div>
  );
}
