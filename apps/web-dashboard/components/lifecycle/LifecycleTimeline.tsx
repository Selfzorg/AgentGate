import type { AuditEventRecord, EvidenceMonitorEventRecord, EvidenceMonitorTaskRecord, ExecutionLogRecord } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/status-badge";

type TimelineItem = {
  id: string;
  at: string;
  kind: "audit" | "evidence" | "log";
  title: string;
  detail: string;
  status?: string | null;
  metadata?: unknown;
};

export function LifecycleTimeline({
  title = "Lifecycle Timeline",
  auditEvents = [],
  evidenceTasks = [],
  evidenceEvents = [],
  executionLogs = [],
  embedded = false
}: {
  title?: string;
  auditEvents?: AuditEventRecord[];
  evidenceTasks?: EvidenceMonitorTaskRecord[];
  evidenceEvents?: EvidenceMonitorEventRecord[];
  executionLogs?: ExecutionLogRecord[];
  embedded?: boolean;
}) {
  const items = [
    ...auditEvents.map((event) => ({
      id: event.id,
      at: event.created_at,
      kind: "audit" as const,
      title: event.event_type,
      detail: `${event.actor_type}${event.actor_id ? `:${event.actor_id}` : ""} sequence ${event.sequence ?? "n/a"}`,
      metadata: event.metadata
    })),
    ...evidenceTasks.map((task) => ({
      id: task.id,
      at: task.updated_at,
      kind: "evidence" as const,
      title: `${task.label} evidence ${task.status}`,
      detail: `${task.check_key} via ${task.runtime} attempt ${task.attempt}`,
      status: task.status,
      metadata: {
        input: task.input,
        result: task.result,
        error: task.error
      }
    })),
    ...evidenceEvents.map((event) => ({
      id: event.id,
      at: event.created_at,
      kind: "audit" as const,
      title: event.event_type,
      detail: `${event.actor_type}${event.actor_id ? `:${event.actor_id}` : ""} sequence ${event.sequence ?? "n/a"}`,
      metadata: event.metadata
    })),
    ...executionLogs.map((log) => ({
      id: log.id,
      at: log.created_at,
      kind: "log" as const,
      title: log.message,
      detail: `${log.level.toUpperCase()} log #${log.sequence}`,
      status: log.level,
      metadata: log.metadata
    }))
  ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  return (
    <section className={embedded ? "rounded-ui border border-border bg-background p-4" : "rounded-ui border border-border bg-surface p-5 shadow-panel"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted">Governance events, evidence work, and execution logs in timestamp order.</p>
        </div>
        <span className="rounded-ui border border-border bg-background px-2 py-1 font-mono text-xs text-muted">{items.length} items</span>
      </div>
      <ol className="mt-4 space-y-2">
        {items.length === 0 ? (
          <li className="rounded-ui border border-border bg-background p-4 text-sm text-muted">No lifecycle activity has been recorded yet.</li>
        ) : (
          items.map((item) => <TimelineRow key={`${item.kind}-${item.id}`} item={item} />)
        )}
      </ol>
    </section>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <li className="grid gap-3 rounded-ui border border-border bg-background p-3 text-sm md:grid-cols-[120px_90px_1fr]">
      <div className="font-mono text-[11px] text-muted">{formatDateTime(item.at)}</div>
      <div>
        {item.kind === "evidence" && item.status ? <StatusBadge kind="evidence" value={item.status} /> : null}
        {item.kind === "log" ? <LogPill level={item.status ?? "info"} /> : null}
        {item.kind === "audit" ? <span className="rounded-ui border border-border px-2 py-1 text-[11px] uppercase text-muted">audit</span> : null}
      </div>
      <div className="min-w-0">
        <div className="font-medium">{item.title}</div>
        <div className="mt-1 text-xs text-muted">{item.detail}</div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-accent">Raw details</summary>
          <pre className="mt-2 max-h-44 overflow-auto rounded-ui border border-border bg-surface p-3 text-[11px] leading-5 text-muted">
            {JSON.stringify(item.metadata ?? {}, null, 2)}
          </pre>
        </details>
      </div>
    </li>
  );
}

function LogPill({ level }: { level: string }) {
  const classes =
    level === "error"
      ? "border-danger/30 bg-danger/10 text-danger"
      : level === "warn"
        ? "border-warning/30 bg-warning/10 text-warning"
        : level === "debug"
          ? "border-border bg-surface text-muted"
          : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200";
  return <span className={`rounded-ui border px-2 py-1 text-[11px] font-semibold uppercase ${classes}`}>{level}</span>;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
