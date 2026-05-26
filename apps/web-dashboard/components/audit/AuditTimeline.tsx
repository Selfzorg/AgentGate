"use client";

import { useEffect, useState } from "react";
import { getAuditEventsByTrace, type AuditEventRecord } from "@/lib/api-client";

export function AuditTimeline({ traceId }: { traceId: string }) {
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [status, setStatus] = useState("Loading audit events...");

  useEffect(() => {
    void getAuditEventsByTrace(traceId)
      .then((response) => {
        setEvents(response.audit_events);
        setStatus(`${response.audit_events.length} audit events loaded.`);
      })
      .catch(() => setStatus("Audit API unavailable. Start the Phase 1 dev server."));
  }, [traceId]);

  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <h2 className="text-base font-semibold">Audit Timeline</h2>
      <p className="mt-1 text-sm text-muted">
        Trace ID: <span className="font-mono">{traceId}</span> · {status}
      </p>
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
              </div>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
