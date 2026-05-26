"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ExternalLink, FlaskConical, X } from "lucide-react";
import {
  approveApproval,
  denyApproval,
  forceDryRun,
  getApprovals,
  type ApprovalRecord
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function ApprovalCard() {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [status, setStatus] = useState("Loading approval packets...");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function loadApprovals() {
    try {
      const response = await getApprovals();
      setApprovals(response.approvals);
      setStatus(`${response.approvals.length} approval packets loaded.`);
    } catch {
      setStatus("Approval API unavailable. Start the Phase 2 dev server.");
    }
  }

  useEffect(() => {
    void loadApprovals();
  }, []);

  async function runAction(label: string, action: () => Promise<unknown>) {
    setPendingAction(label);
    try {
      await action();
      await loadApprovals();
      setStatus(`${label} completed.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setPendingAction(null);
    }
  }

  if (approvals.length === 0) {
    return (
      <section className="max-w-2xl rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">No approval packets yet</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Replay a production deploy or run the DB migration dry-run from Live Activity to create one.
            </p>
          </div>
          <span className="rounded-ui border border-border px-2 py-1 text-xs text-muted">Phase 2</span>
        </div>
        <p className="mt-4 text-sm text-muted">{status}</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{status}</p>
      {approvals.map((approval) => {
        const comment = comments[approval.id] ?? "";
        const missingChecks = approval.skill_run.gate_checks.filter((check) => check.status !== "passed");
        const approveBlocked =
          approval.status !== "pending" ||
          missingChecks.length > 0 ||
          (approval.risk_level === "critical" && comment.trim().length === 0);

        return (
          <section key={approval.id} className="rounded-ui border border-border bg-surface p-5 shadow-panel">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
              <div>
                <h2 className="text-base font-semibold">{approval.skill_run.skill?.name ?? "Approval packet"}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{approval.skill_run.reason}</p>
                <p className="mt-2 font-mono text-xs text-muted">{approval.skill_run.raw_action}</p>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{approval.status}</div>
                <div className="text-xs text-muted">{approval.risk_level} risk · {approval.approval_readiness}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <h3 className="text-sm font-semibold">Gate Checks</h3>
                <div className="mt-2 grid gap-2">
                  {approval.skill_run.gate_checks.map((check) => (
                    <div key={check.id} className="flex items-center justify-between rounded-ui border border-border px-3 py-2 text-sm">
                      <span>{check.label}</span>
                      <span
                        className={
                          check.status === "passed"
                            ? "font-semibold text-success"
                            : check.status === "failed"
                              ? "font-semibold text-danger"
                              : "font-semibold text-warning"
                        }
                      >
                        {check.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold">Evidence</h3>
                <div className="mt-2 rounded-ui border border-border bg-background p-3 text-sm leading-6 text-muted">
                  {approval.skill_run.dry_run_result ? (
                    <>
                      <div className="font-medium text-foreground">{approval.skill_run.dry_run_result.summary}</div>
                      <div className="mt-1 font-mono text-xs">dry-run {approval.skill_run.dry_run_result.id}</div>
                    </>
                  ) : (
                    "Policy evidence and gate checks are stored for this approval packet."
                  )}
                </div>
                <label className="mt-4 block text-sm font-medium" htmlFor={`comment-${approval.id}`}>
                  Approval comment{approval.risk_level === "critical" ? " required" : ""}
                </label>
                <textarea
                  id={`comment-${approval.id}`}
                  className="mt-2 min-h-20 w-full rounded-ui border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
                  value={comment}
                  onChange={(event) => setComments((current) => ({ ...current, [approval.id]: event.target.value }))}
                  placeholder="Add approval context"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="accent"
                disabled={approveBlocked || pendingAction !== null}
                onClick={() =>
                  void runAction("Approve Once", () => approveApproval(approval.id, comment))
                }
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Approve Once
              </Button>
              <Button
                variant={approval.risk_level === "critical" ? "default" : "secondary"}
                disabled={approval.status !== "pending" || pendingAction !== null}
                onClick={() => void runAction("Force Dry-Run", () => forceDryRun(approval.id))}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                Force Dry-Run
              </Button>
              <Button
                variant="secondary"
                disabled={approval.status !== "pending" || pendingAction !== null}
                onClick={() => void runAction("Deny", () => denyApproval(approval.id, comment))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Deny
              </Button>
              <Button asChild variant="ghost">
                <Link href={`/audit/${approval.skill_run.trace_id}`}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open Trace
                </Link>
              </Button>
            </div>

            {missingChecks.length > 0 ? (
              <p className="mt-3 text-sm text-warning">
                Approval blocked by {missingChecks.map((check) => check.check_key).join(", ")}.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
