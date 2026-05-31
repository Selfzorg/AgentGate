"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, ArrowUp, Clock3, ExternalLink, ListChecks, RefreshCw, Search, ServerCog, Trash2, X } from "lucide-react";
import {
  clearActiveEvidenceQueue,
  getEvidenceTask,
  getEvidenceMonitor,
  prioritizeEvidenceTask,
  type EvidenceMonitorResponse,
  type EvidenceMonitorTaskRecord,
  type EvidenceWorkerRecord
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { LifecycleTimeline } from "@/components/lifecycle/LifecycleTimeline";

const taskColumns = ["Task", "Check", "Runtime", "Priority", "Worker", "Status", "Run", "Updated"];
const evidenceStatuses = ["", "queued", "claimed", "running", "succeeded", "failed", "timed_out", "cancelled"];

export function EvidenceMonitor() {
  const [monitor, setMonitor] = useState<EvidenceMonitorResponse | null>(null);
  const [status, setStatus] = useState("Loading evidence queue...");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [directTask, setDirectTask] = useState<EvidenceMonitorTaskRecord | null>(null);
  const [filters, setFilters] = useState({
    q: "",
    task_id: "",
    run_id: "",
    trace_id: "",
    check_key: "",
    status: "",
    runtime: ""
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [refreshing, setRefreshing] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function loadMonitor(nextFilters = appliedFilters) {
    setRefreshing(true);
    try {
      const response = await getEvidenceMonitor(cleanFilters(nextFilters));
      setMonitor(response);
      setStatus(
        `${response.queue.active} active evidence tasks, ${response.tasks.length} matching tasks, ${response.workers.length} worker records.`
      );
      const requestedTaskId = nextFilters.task_id || selectedTaskId;
      if (requestedTaskId && !response.tasks.some((task) => task.id === requestedTaskId)) {
        try {
          const detail = await getEvidenceTask(requestedTaskId);
          setDirectTask(detail.evidence_task);
          setSelectedTaskId(requestedTaskId);
        } catch {
          setDirectTask(null);
        }
      } else {
        setDirectTask(null);
      }
      if (!requestedTaskId && response.tasks.length > 0) {
        setSelectedTaskId(response.tasks[0]?.id ?? null);
      }
    } catch {
      setStatus("Evidence monitor API unavailable. Start the AgentGate dev server.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = {
      q: params.get("q") ?? "",
      task_id: params.get("task_id") ?? "",
      run_id: params.get("run_id") ?? "",
      trace_id: params.get("trace_id") ?? "",
      check_key: params.get("check_key") ?? "",
      status: params.get("status") ?? "",
      runtime: params.get("runtime") ?? ""
    };
    setFilters(initial);
    setAppliedFilters(initial);
    if (initial.task_id) setSelectedTaskId(initial.task_id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setRefreshing(true);
      try {
        const response = await getEvidenceMonitor(cleanFilters(appliedFilters));
        if (!cancelled) {
          setMonitor(response);
          setStatus(
            `${response.queue.active} active evidence tasks, ${response.tasks.length} matching tasks, ${response.workers.length} worker records.`
          );
          if (appliedFilters.task_id && !response.tasks.some((task) => task.id === appliedFilters.task_id)) {
            try {
              const detail = await getEvidenceTask(appliedFilters.task_id);
              if (!cancelled) {
                setDirectTask(detail.evidence_task);
                setSelectedTaskId(appliedFilters.task_id);
              }
            } catch {
              if (!cancelled) setDirectTask(null);
            }
          } else if (!cancelled) {
            setDirectTask(null);
          }
          if (!selectedTaskId && !appliedFilters.task_id && response.tasks.length > 0) {
            setSelectedTaskId(response.tasks[0]?.id ?? null);
          }
        }
      } catch {
        if (!cancelled) {
          setStatus("Evidence monitor API unavailable. Start the AgentGate dev server.");
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }

    void load();
    const interval = window.setInterval(() => void load(), 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [appliedFilters, selectedTaskId]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(filters);
    const params = new URLSearchParams(cleanFilters(filters));
    window.history.replaceState(null, "", `/evidence${params.size ? `?${params.toString()}` : ""}`);
    if (filters.task_id) setSelectedTaskId(filters.task_id);
    void loadMonitor(filters);
  }

  function clearFilters() {
    const empty = {
      q: "",
      task_id: "",
      run_id: "",
      trace_id: "",
      check_key: "",
      status: "",
      runtime: ""
    };
    setFilters(empty);
    setAppliedFilters(empty);
    setDirectTask(null);
    window.history.replaceState(null, "", "/evidence");
    void loadMonitor(empty);
  }

  async function handleClearQueue() {
    if (!window.confirm("Cancel all active evidence tasks? Historical completed evidence will stay in the audit trail.")) return;
    setPendingAction("clear");
    try {
      const response = await clearActiveEvidenceQueue();
      setStatus(`Cancelled ${response.cancelled_count} active evidence tasks across ${response.affected_run_count} runs.`);
      await loadMonitor();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to clear evidence queue.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePrioritize(taskId: string) {
    setPendingAction(`prioritize:${taskId}`);
    try {
      await prioritizeEvidenceTask(taskId);
      setStatus(`Prioritized evidence task ${taskId}.`);
      await loadMonitor();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to prioritize evidence task.");
    } finally {
      setPendingAction(null);
    }
  }

  const tasks = useMemo(() => {
    const rows = monitor?.tasks ?? [];
    if (!directTask || rows.some((task) => task.id === directTask.id)) return rows;
    return [directTask, ...rows];
  }, [directTask, monitor]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null,
    [tasks, selectedTaskId]
  );

  if (!monitor) {
    return (
      <div className="space-y-5">
        <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Evidence Queue</h2>
              <p className="mt-1 text-sm leading-6 text-muted">{status}</p>
            </div>
            <Button variant="secondary" disabled={refreshing} onClick={() => void loadMonitor()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {refreshing ? "Loading" : "Refresh"}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form className="rounded-ui border border-border bg-surface p-4 shadow-panel" onSubmit={handleSearch}>
        <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(5,minmax(120px,1fr))_auto_auto]">
          <TextFilter label="Search" value={filters.q} placeholder="Task, run, trace, check, action" onChange={(q) => setFilters((current) => ({ ...current, q }))} />
          <TextFilter label="Task ID" value={filters.task_id} placeholder="evtsk_..." onChange={(task_id) => setFilters((current) => ({ ...current, task_id }))} />
          <TextFilter label="Run ID" value={filters.run_id} placeholder="run_..." onChange={(run_id) => setFilters((current) => ({ ...current, run_id }))} />
          <TextFilter label="Trace ID" value={filters.trace_id} placeholder="trc_..." onChange={(trace_id) => setFilters((current) => ({ ...current, trace_id }))} />
          <TextFilter label="Check" value={filters.check_key} placeholder="ci_passed" onChange={(check_key) => setFilters((current) => ({ ...current, check_key }))} />
          <label className="text-sm font-medium">
            Status
            <select
              suppressHydrationWarning
              className="mt-2 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              {evidenceStatuses.map((value) => (
                <option key={value || "all"} value={value}>
                  {value || "all"}
                </option>
              ))}
            </select>
          </label>
          <Button className="self-end" type="submit" variant="primary" disabled={refreshing || pendingAction !== null}>
            <Search className="h-4 w-4" aria-hidden="true" />
            Search
          </Button>
          <Button className="self-end" type="button" variant="ghost" disabled={refreshing || pendingAction !== null} onClick={clearFilters}>
            <X className="h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
        </div>
        <div className="mt-3 max-w-sm">
          <TextFilter label="Runtime" value={filters.runtime} placeholder="codex_cli" onChange={(runtime) => setFilters((current) => ({ ...current, runtime }))} />
        </div>
      </form>

      <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Evidence Queue</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              {status} Claude/Codex workers update this feed through database-backed heartbeats.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pendingAction !== null || (monitor?.queue.active ?? 0) === 0}
              onClick={() => void handleClearQueue()}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {pendingAction === "clear" ? "Clearing" : "Clear Active Queue"}
            </Button>
            <Button variant="secondary" disabled={refreshing || pendingAction !== null} onClick={() => void loadMonitor()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Active" value={monitor?.queue.active ?? 0} detail={`${monitor?.queue.queued ?? 0} queued`} />
          <Metric label="Running" value={(monitor?.queue.claimed ?? 0) + (monitor?.queue.running ?? 0)} detail="claimed or leased" />
          <Metric label="Succeeded" value={monitor?.queue.succeeded ?? 0} detail="completed evidence" />
          <Metric label="Failed" value={(monitor?.queue.failed ?? 0) + (monitor?.queue.timed_out ?? 0)} detail="failed or timed out" />
        </div>
      </section>

      <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Workers</h2>
            <p className="mt-1 text-sm text-muted">Heartbeat, current task, and processed counters for Claude/Codex evidence workers.</p>
          </div>
          <StatusBadge kind="worker" value={workerFleetStatus(monitor?.workers ?? [])} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {monitor?.workers.length ? (
            monitor.workers.map((worker) => <WorkerCard key={worker.id} worker={worker} />)
          ) : (
            <div className="rounded-ui border border-border bg-background p-4 text-sm text-muted lg:col-span-3">
              No worker heartbeat has been recorded yet. Start Claude, or run <span className="font-mono">pnpm evidence:claude-worker</span>.
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
          <div className="border-b border-border p-5">
            <h2 className="text-base font-semibold">Task Timeline</h2>
            <p className="mt-1 text-sm text-muted">Newest evidence tasks across queued, running, succeeded, failed, and cancelled states.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full border-collapse text-left text-sm">
              <thead className="bg-background text-xs uppercase text-muted">
                <tr>
                  {taskColumns.map((column) => (
                    <th key={column} className="border-b border-border px-4 py-3 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.length ? (
                  tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/10"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-accent">{shortId(task.id)}</div>
                        <div className="mt-1 text-xs text-muted">attempt {task.attempt}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{task.label}</div>
                        <div className="font-mono text-xs text-muted">{task.check_key}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{task.runtime}</td>
                      <td className="px-4 py-3 font-mono text-xs">{task.priority}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-muted">
                        {task.claimed_by_agent_id ?? "unclaimed"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge kind="evidence" value={task.status} />
                      </td>
                      <td className="px-4 py-3">
                        <a className="font-mono text-xs text-accent" href={`/skill-runs/${task.skill_run_id}`}>
                          {shortId(task.skill_run_id)}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{formatDateTime(task.updated_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-8 text-muted" colSpan={taskColumns.length}>
                      No evidence tasks match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <TaskDetail task={selectedTask} pendingAction={pendingAction} onPrioritize={handlePrioritize} />
      </div>

      <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold">Recent Evidence Events</h2>
        </div>
        <div className="mt-3 grid gap-2">
          {monitor?.events.length ? (
            monitor.events.slice(0, 12).map((event) => (
              <div key={event.id} className="grid gap-2 rounded-ui border border-border bg-background px-3 py-2 text-sm md:grid-cols-[220px_1fr_auto]">
                <div className="font-mono text-xs text-muted">{formatDateTime(event.created_at)}</div>
                <div>
                  <span className="font-medium">{event.event_type}</span>
                  <span className="ml-2 text-xs text-muted">{event.actor_id ?? event.actor_type}</span>
                </div>
                <a className="text-xs font-medium text-accent" href={`/audit/${event.trace_id}`}>
                  Open Trace
                </a>
              </div>
            ))
          ) : (
            <div className="rounded-ui border border-border bg-background p-4 text-sm text-muted">No evidence audit events yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-ui border border-border bg-background p-4">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </div>
  );
}

function WorkerCard({ worker }: { worker: EvidenceWorkerRecord }) {
  return (
    <div className="rounded-ui border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-muted">{worker.agent_id}</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-medium">
            <ServerCog className="h-4 w-4 text-accent" aria-hidden="true" />
            {worker.driver} · {worker.runtime}
          </div>
        </div>
        <StatusBadge kind="worker" value={worker.effective_status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <SmallStat label="Processed" value={worker.processed_count} />
        <SmallStat label="Failed" value={worker.failed_count} />
      </div>
      <div className="mt-4 space-y-1 text-xs text-muted">
        <div className="flex items-center gap-2">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          heartbeat {formatDuration(worker.heartbeat_age_ms)} ago
        </div>
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          {worker.current_task_id ? `${shortId(worker.current_task_id)} · ${worker.current_check_key ?? "check"}` : "no task claimed"}
        </div>
      </div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function TaskDetail({
  task,
  pendingAction,
  onPrioritize
}: {
  task: EvidenceMonitorTaskRecord | null;
  pendingAction: string | null;
  onPrioritize: (taskId: string) => void;
}) {
  if (!task) {
    return (
      <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
        <h2 className="text-base font-semibold">Task Detail</h2>
        <p className="mt-2 text-sm text-muted">Select an evidence task to inspect its worker, result, and linked run.</p>
      </section>
    );
  }

  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{task.label}</h2>
          <p className="mt-1 font-mono text-xs text-muted">{task.id}</p>
        </div>
        <StatusBadge kind="evidence" value={task.status} />
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <DetailRow label="Check" value={task.check_key} />
        <DetailRow label="Runtime" value={task.runtime} />
        <DetailRow label="Priority" value={String(task.priority)} />
        <DetailRow label="Worker" value={task.claimed_by_agent_id ?? "unclaimed"} />
        <DetailRow label="Gate" value={task.gate_check_status} />
        <DetailRow label="Lease" value={task.lease_expires_at ? formatDateTime(task.lease_expires_at) : "none"} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!isActiveTask(task.status) || pendingAction !== null}
          onClick={() => onPrioritize(task.id)}
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
          {pendingAction === `prioritize:${task.id}` ? "Prioritizing" : "Prioritize"}
        </Button>
        <Button asChild variant="secondary">
          <a href={`/skill-runs/${task.skill_run_id}`}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open Run
          </a>
        </Button>
        <Button asChild variant="ghost">
          <a href={`/audit/${task.trace_id}`}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open Trace
          </a>
        </Button>
      </div>

      {task.gate_check ? (
        <div className="mt-5 rounded-ui border border-border bg-background p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">{task.gate_check.label}</div>
              <div className="mt-1 font-mono text-xs text-muted">{task.gate_check.check_key}</div>
            </div>
            <StatusBadge kind="gate" value={task.gate_check.status} />
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Input</h3>
        <pre className="mt-2 max-h-56 overflow-auto rounded-ui border border-border bg-background p-3 text-xs leading-5 text-muted">
          {jsonPreview(task.input)}
        </pre>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Result</h3>
        <pre className="mt-2 max-h-56 overflow-auto rounded-ui border border-border bg-background p-3 text-xs leading-5 text-muted">
          {jsonPreview(task.result)}
        </pre>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">Error</h3>
        <pre className="mt-2 max-h-40 overflow-auto rounded-ui border border-border bg-background p-3 text-xs leading-5 text-muted">
          {jsonPreview(task.error)}
        </pre>
      </div>

      <div className="mt-5">
        <LifecycleTimeline
          title="Evidence Lifecycle"
          evidenceTasks={[task]}
          evidenceEvents={task.audit_events ?? []}
          embedded
        />
      </div>
    </section>
  );
}

function isActiveTask(status: EvidenceMonitorTaskRecord["status"]) {
  return status === "queued" || status === "claimed" || status === "running";
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3">
      <div className="text-muted">{label}</div>
      <div className="min-w-0 truncate font-mono text-xs">{value}</div>
    </div>
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

function workerFleetStatus(workers: EvidenceWorkerRecord[]) {
  if (workers.some((worker) => worker.effective_status === "busy")) return "busy";
  if (workers.some((worker) => worker.effective_status === "online" || worker.effective_status === "idle")) return "online";
  if (workers.some((worker) => worker.effective_status === "error")) return "error";
  return "offline";
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(ms: number) {
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function jsonPreview(value: unknown) {
  const formatted = JSON.stringify(value ?? {}, null, 2);
  return formatted.length > 1200 ? `${formatted.slice(0, 1200)}\n...` : formatted;
}

function cleanFilters(filters: Record<string, string>) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim().length > 0));
}
