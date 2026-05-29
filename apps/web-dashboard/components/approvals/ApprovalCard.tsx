"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Check, ExternalLink, FlaskConical, RefreshCw, Search, X } from "lucide-react";
import {
  approveApproval,
  denyApproval,
  forceDryRun,
  getApprovals,
  retryApprovalEvidence,
  type ApprovalRecord
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const APPROVAL_PAGE_SIZE = 25;

export function ApprovalCard() {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [status, setStatus] = useState("Loading approval packets...");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pagination, setPagination] = useState<{
    limit: number;
    offset: number;
    total: number;
    has_more: boolean;
  } | null>(null);

  async function loadApprovals(options: { append?: boolean; query?: string } = {}) {
    const offset = options.append ? approvals.length : 0;
    const query = options.query ?? searchQuery;
    setLoading(true);
    try {
      const response = await getApprovals({ limit: APPROVAL_PAGE_SIZE, offset, ...(query ? { q: query } : {}) });
      const visibleCount = offset + response.approvals.length;
      setApprovals((current) => (options.append ? [...current, ...response.approvals] : response.approvals));
      setPagination(response.pagination);
      setStatus(
        `${query ? `Search "${query}": ` : ""}Showing ${visibleCount} of ${response.pagination.total} approval packets.`
      );
    } catch {
      setStatus("Approval API unavailable. Start the Phase 2 dev server.");
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchInput.trim();
    setSearchQuery(query);
    void loadApprovals({ query });
  }

  function clearSearch() {
    setSearchInput("");
    setSearchQuery("");
    void loadApprovals({ query: "" });
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

  const searchControls = (
    <form className="flex flex-wrap items-end gap-2 rounded-ui border border-border bg-surface p-4 shadow-panel" onSubmit={handleSearch}>
      <label className="min-w-0 flex-1 text-sm font-medium">
        Find approval
        <input
          className="mt-2 w-full rounded-ui border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Run ID, trace ID, approval ID, or action"
        />
      </label>
      <Button type="submit" variant="secondary" disabled={loading || pendingAction !== null}>
        <Search className="h-4 w-4" aria-hidden="true" />
        Search
      </Button>
      {searchQuery ? (
        <Button type="button" variant="ghost" disabled={loading || pendingAction !== null} onClick={clearSearch}>
          <X className="h-4 w-4" aria-hidden="true" />
          Clear
        </Button>
      ) : null}
    </form>
  );

  if (approvals.length === 0) {
    const title = loading ? "Loading approval packets" : "No approval packets found";
    const description = loading
      ? "Fetching approval packets from the AgentGate API."
      : searchQuery
        ? "Try a different run ID, trace ID, approval ID, or action."
        : "Replay a production deploy or run the DB migration dry-run from Live Activity to create one.";

    return (
      <div className="space-y-4">
        {searchControls}
        <section className="max-w-2xl rounded-ui border border-border bg-surface p-5 shadow-panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
            </div>
            <StatusBadge kind="approval" value="ready" label={loading ? "Loading" : "Waiting"} />
          </div>
          <p className="mt-4 text-sm text-muted">{status}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {searchControls}
      <p className="text-sm text-muted">{status} Sorted by pending status first, then newest created time.</p>
      {approvals.map((approval) => {
        const comment = comments[approval.id] ?? "";
        const missingChecks = approval.skill_run.gate_checks.filter((check) => check.status !== "passed");
        const collecting = approval.approval_readiness === "collecting";
        const approveBlocked =
          approval.status !== "pending" ||
          collecting ||
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
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                <StatusBadge kind="approval" value={approval.status} />
                <StatusBadge kind="approval" value={approval.approval_readiness} label={`readiness ${approval.approval_readiness}`} />
                <StatusBadge kind="risk" value={approval.risk_level} />
                <StatusBadge kind="run" value={approval.skill_run.status} />
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <h3 className="text-sm font-semibold">Gate Checks</h3>
                <div className="mt-2 grid gap-2">
                  {approval.skill_run.gate_checks.map((check) => {
                    const taskId = evidenceTaskId(check.evidence);

                    return (
                      <div key={check.id} className="rounded-ui border border-border px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div>{check.label}</div>
                            <div className="mt-1 max-w-xl text-xs leading-5 text-muted">{evidenceReason(check.evidence)}</div>
                            <div className="mt-1 max-w-xl font-mono text-[11px] leading-5 text-muted">{evidenceMeta(check.evidence)}</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge kind="gate" value={check.status} />
                            {taskId ? (
                              <Button asChild variant="ghost">
                                <Link href={`/evidence?task_id=${taskId}`}>
                                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                  Open Evidence
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              disabled={approval.status !== "pending" || pendingAction !== null}
                              onClick={() =>
                                void runAction(`Queue ${check.label} evidence`, () => retryApprovalEvidence(approval.id, check.check_key))
                              }
                            >
                              <RefreshCw className="h-4 w-4" aria-hidden="true" />
                              Retry
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                disabled={approval.status !== "pending" || pendingAction !== null || collecting}
                onClick={() => void runAction("Queue Evidence", () => retryApprovalEvidence(approval.id))}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Retry Evidence
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
              <Button asChild variant="ghost">
                <Link href={`/skill-runs/${approval.skill_run.id}`}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open Run
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
      {pagination?.has_more ? (
        <div className="flex items-center justify-between gap-3 rounded-ui border border-border bg-surface p-4 shadow-panel">
          <p className="text-sm text-muted">
            Showing {approvals.length} of {pagination.total}. Older approval packets stay available without loading the whole queue at once.
          </p>
          <Button variant="secondary" disabled={loading || pendingAction !== null} onClick={() => void loadApprovals({ append: true })}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {loading ? "Loading" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function evidenceReason(evidence: Record<string, unknown>): string {
  if (typeof evidence.reason === "string") return evidence.reason;
  if (typeof evidence.evidence_task_id === "string") return "Evidence task is queued for an agent worker.";
  if (typeof evidence.status === "string") return `Evidence status: ${evidence.status}.`;
  return "Evidence is waiting for collection.";
}

function evidenceMeta(evidence: Record<string, unknown>): string {
  const evidenceSkill = recordFrom(evidence.evidence_skill);
  const skillId = typeof evidenceSkill.skill_id === "string" ? evidenceSkill.skill_id : null;
  const runtime = typeof evidence.selected_runtime === "string" ? evidence.selected_runtime : null;
  const taskId = typeof evidence.evidence_task_id === "string" ? evidence.evidence_task_id : null;
  if (skillId && runtime && taskId) return `${skillId} via ${runtime} task ${taskId}`;
  if (skillId && runtime) return `${skillId} via ${runtime}`;
  if (skillId) return skillId;
  if (runtime) return `runtime ${runtime}`;
  return "";
}

function evidenceTaskId(evidence: Record<string, unknown>): string | null {
  return typeof evidence.evidence_task_id === "string" ? evidence.evidence_task_id : null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
