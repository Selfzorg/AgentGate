import type { SkillImportCandidate } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  defaultReviewDraft,
  evidenceWarningsForChecks,
  uniqueStrings,
  type CandidateReviewDraft
} from "./import-review-helpers";
import { SourcePill, splitCsv } from "./skill-registry-ui";

export function SkillCandidateDetail({
  candidate,
  review,
  editable,
  onReviewChange
}: {
  candidate: SkillImportCandidate | null;
  review: CandidateReviewDraft | null;
  editable: boolean;
  onReviewChange: (candidateId: string, review: CandidateReviewDraft) => void;
}) {
  if (!candidate) {
    return <aside className="border-t border-border p-5 text-sm text-muted lg:border-l lg:border-t-0">No candidate selected.</aside>;
  }

  const activeReview = review ?? defaultReviewDraft(candidate);
  const reviewedChecks = splitCsv(activeReview.requiredChecks);
  const reviewedAliases = splitCsv(activeReview.policyAliases);
  const evidenceWarnings = [
    ...(candidate.evidence_warnings ?? []),
    ...evidenceWarningsForChecks(reviewedChecks, candidate.required_evidence_raw ?? [])
  ];
  const allWarnings = uniqueStrings([...candidate.warnings, ...evidenceWarnings]);

  return (
    <aside className="border-t border-border p-5 lg:border-l lg:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="risk" value={candidate.default_risk_level} />
        <SourcePill value={candidate.source_type} />
        <StatusBadge kind="gate" value={candidate.review_status} />
      </div>
      <h3 className="mt-4 text-base font-semibold">{candidate.name}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{candidate.description ?? "No description."}</p>
      <div className="mt-4 grid gap-3 text-xs">
        <DetailRow label="Path" value={candidate.relative_path} />
        <DetailRow label="Hash" value={candidate.content_hash} />
        <DetailRow label="Skill Type" value={candidate.skill_type} />
        <DetailRow label="Side Effect" value={candidate.side_effect_level} />
        <DetailRow label="Runtimes" value={candidate.allowed_runtimes.join(", ") || "none"} />
        <DetailRow label="Tools" value={candidate.declared_tools.join(", ") || "none"} />
        <DetailRow label="Raw Evidence" value={(candidate.required_evidence_raw ?? []).join(", ") || "none"} />
        <DetailRow label="Inferred Checks" value={(candidate.inferred_required_checks ?? []).join(", ") || "none"} />
        <DetailRow label="Policy Aliases" value={(candidate.inferred_policy_aliases ?? []).join(", ") || "none"} />
      </div>
      <div className="mt-4 grid gap-3 text-xs">
        <label>
          <span className="font-semibold uppercase text-muted">Required Checks</span>
          <input
            value={activeReview.requiredChecks}
            disabled={!editable}
            onChange={(event) => onReviewChange(candidate.candidate_id, { ...activeReview, requiredChecks: event.target.value })}
            className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 font-mono text-xs outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <label>
          <span className="font-semibold uppercase text-muted">Policy Aliases</span>
          <input
            value={activeReview.policyAliases}
            disabled={!editable}
            onChange={(event) => onReviewChange(candidate.candidate_id, { ...activeReview, policyAliases: event.target.value })}
            className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 font-mono text-xs outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        {reviewedAliases.length > 0 ? <DetailRow label="Alias Count" value={String(reviewedAliases.length)} /> : null}
        {!editable ? (
          <div className="rounded-ui border border-border bg-background p-2 text-xs text-muted">
            Create a review snapshot to edit evidence and aliases.
          </div>
        ) : null}
      </div>
      <div className="mt-4 space-y-2">
        {allWarnings.length > 0 ? (
          allWarnings.map((warning) => (
            <div key={warning} className="rounded-ui border border-warning/30 bg-warning/10 p-2 text-xs leading-5 text-warning">
              {warning}
            </div>
          ))
        ) : (
          <div className="rounded-ui border border-border bg-background p-2 text-xs text-muted">No import warnings.</div>
        )}
      </div>
    </aside>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-semibold uppercase text-muted">{label}</div>
      <div className="mt-1 break-words font-mono text-muted">{value}</div>
    </div>
  );
}
