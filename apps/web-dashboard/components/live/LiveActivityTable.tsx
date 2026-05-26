"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { getLiveActivity, runSkillRunDryRun, type LiveActivity } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

const columns = ["Time", "Agent", "Role", "Source", "Raw Action", "Skill", "Environment", "Risk", "Decision", "Trace"];

const decisionTone: Record<string, string> = {
  ALLOW: "bg-success/10 text-success",
  DENY: "bg-danger/10 text-danger",
  REQUIRE_APPROVAL: "bg-warning/10 text-warning",
  FORCE_DRY_RUN: "bg-accent/10 text-accent"
};

const riskTone: Record<string, string> = {
  low: "text-success",
  medium: "text-accent",
  high: "text-warning",
  critical: "text-danger"
};

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
          setStatus("API unavailable. Start the Phase 1 dev server.");
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
        <p className="mt-1 text-sm text-muted">{status}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full border-collapse text-left text-sm">
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
                  <td className="px-4 py-3">{activity.agent_display_name ?? activity.agent_id ?? "Unknown"}</td>
                  <td className="px-4 py-3 text-muted">{activity.role ?? "unknown"}</td>
                  <td className="px-4 py-3 text-muted">{activity.source}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs">{activity.raw_action}</td>
                  <td className="px-4 py-3">{activity.skill_id ?? "unresolved"}</td>
                  <td className="px-4 py-3 text-muted">{activity.environment ?? "n/a"}</td>
                  <td className={`px-4 py-3 font-medium ${activity.risk_level ? riskTone[activity.risk_level] : ""}`}>
                    {activity.risk_level ?? "n/a"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-2">
                      <span className={`rounded-ui px-2 py-1 text-xs font-semibold ${decisionTone[activity.decision ?? ""] ?? "bg-background text-muted"}`}>
                        {activity.decision ?? "n/a"}
                      </span>
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
                    <Link className="font-mono text-xs text-accent" href={`/audit/${activity.trace_id}`}>
                      {activity.trace_id}
                    </Link>
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
