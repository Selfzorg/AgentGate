"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { getLiveActivity, runSkillRunDryRun, type LiveActivity } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const columns = ["Time", "Agent", "Action", "Skill", "Environment", "Status", "Risk", "Decision", "Run", "Audit"];

export function LiveActivityTable() {
  const [activities, setActivities] = useState<LiveActivity[]>([]);
  const [status, setStatus] = useState("Loading persisted activity...");
  const [dryRunPending, setDryRunPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await getLiveActivity();
        if (!cancelled) {
          setActivities(response.activities);
          setStatus(`${response.activities.length} persisted decisions loaded.`);
        }
      } catch {
        if (!cancelled) {
          setStatus("API unavailable. Start the Phase 3 dev server.");
        }
      }
    }

    void load();
    const interval = window.setInterval(() => void load(), 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function handleDryRun(runId: string) {
    setDryRunPending(runId);
    try {
      const result = await runSkillRunDryRun(runId);
      setStatus(`${result.dry_run_result.summary} Approval packet is ready.`);
      const response = await getLiveActivity();
      setActivities(response.activities);
    } catch {
      setStatus("Dry-run failed. Check whether the skill supports dry-run.");
    } finally {
      setDryRunPending(null);
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
      <div className="border-b border-border p-5">
        <h2 className="text-base font-semibold">Activity Stream</h2>
        <p className="mt-1 text-sm text-muted">
          {status} Open a run for token, logs, and AI Insights; open audit for lifecycle completeness.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full border-collapse text-left text-sm">
          <thead className="bg-background text-xs uppercase text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} className="border-b border-border px-4 py-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activities.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-muted" colSpan={columns.length}>
                  No persisted decisions yet. Replay a demo action to create one.
                </td>
              </tr>
            ) : (
              activities.map((activity) => (
                <tr key={activity.run_id} className="border-b border-border last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                    {new Date(activity.time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit"
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div>{activity.agent_display_name ?? activity.agent_id ?? "Unknown"}</div>
                    <div className="text-xs text-muted">{activity.role ?? "unknown"} · {activity.source}</div>
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 font-mono text-xs">{activity.raw_action}</td>
                  <td className="px-4 py-3">{activity.skill_id ?? "unresolved"}</td>
                  <td className="px-4 py-3 text-muted">{activity.environment ?? "n/a"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge kind="run" value={activity.status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge kind="risk" value={activity.risk_level} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-2">
                      <StatusBadge kind="decision" value={activity.decision} />
                      {activity.decision === "FORCE_DRY_RUN" ? (
                        <Button
                          className="h-8 px-2 text-xs"
                          variant="secondary"
                          disabled={dryRunPending === activity.run_id}
                          onClick={() => void handleDryRun(activity.run_id)}
                        >
                          <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                          {dryRunPending === activity.run_id ? "Running" : "Dry-Run"}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <a className="font-mono text-xs text-accent" href={`/skill-runs/${activity.run_id}`}>
                      {activity.run_id}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <a className="font-mono text-xs text-accent" href={`/audit/${activity.trace_id}`}>
                      {activity.trace_id}
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
