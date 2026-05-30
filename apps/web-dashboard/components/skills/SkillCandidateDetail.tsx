import type { SkillImportCandidate } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  defaultReviewDraft,
  evidenceWarningsForChecks,
  knownEvidenceChecks,
  uniqueStrings,
  type CandidateReviewDraft,
  type EvidenceCheckOption
} from "./import-review-helpers";
import { SourcePill, splitCsv } from "./skill-registry-ui";

export function SkillCandidateDetail({
  candidate,
  review,
  editable,
  evidenceOptions,
  onReviewChange
}: {
  candidate: SkillImportCandidate | null;
  review: CandidateReviewDraft | null;
  editable: boolean;
  evidenceOptions: EvidenceCheckOption[];
  onReviewChange: (candidateId: string, review: CandidateReviewDraft) => void;
}) {
  if (!candidate) {
    return <aside className="border-t border-border p-5 text-sm text-muted lg:border-l lg:border-t-0">No candidate selected.</aside>;
  }

  const activeReview = review ?? defaultReviewDraft(candidate);
  const reviewedChecks = splitCsv(activeReview.requiredChecks);
  const reviewedAliases = splitCsv(activeReview.policyAliases);
  const unknownChecks = reviewedChecks.filter((check) => !knownEvidenceChecks.has(check));
  const evidenceWarnings = [
    ...(candidate.evidence_warnings ?? []),
    ...evidenceWarningsForChecks(reviewedChecks, candidate.required_evidence_raw ?? [])
  ];
  const allWarnings = uniqueStrings([...candidate.warnings, ...evidenceWarnings]);
  const optionKeys = new Set(evidenceOptions.map((option) => option.key));
  const mergedOptions = [
    ...evidenceOptions,
    ...reviewedChecks
      .filter((check) => !optionKeys.has(check))
      .map((check) => ({
        key: check,
        label: check,
        description: "Custom check. This needs a matching evidence skill or worker before approval can pass.",
        source: "custom" as const
      }))
  ];

  function setRequiredChecks(nextChecks: string[]) {
    onReviewChange(candidate!.candidate_id, {
      ...activeReview,
      requiredChecks: uniqueStrings(nextChecks).join(", ")
    });
  }

  function toggleRequiredCheck(checkKey: string) {
    setRequiredChecks(reviewedChecks.includes(checkKey) ? reviewedChecks.filter((check) => check !== checkKey) : [...reviewedChecks, checkKey]);
  }

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
          <span className="mt-1 block text-[11px] font-normal normal-case leading-5 text-muted">
            Pick registered evidence checks below, or type a custom key. Custom keys stay blocking until a worker can satisfy them.
          </span>
          <input
            value={activeReview.requiredChecks}
            disabled={!editable}
            onChange={(event) => onReviewChange(candidate.candidate_id, { ...activeReview, requiredChecks: event.target.value })}
            className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 font-mono text-xs outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <div>
          <div className="font-semibold uppercase text-muted">Evidence Options</div>
          <div className="mt-2 grid max-h-60 gap-2 overflow-y-auto pr-1">
            {mergedOptions.map((option) => {
              const selected = reviewedChecks.includes(option.key);
              const unknown = !knownEvidenceChecks.has(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={!editable}
                  onClick={() => toggleRequiredCheck(option.key)}
                  className={`rounded-ui border p-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected ? "border-accent bg-accent/10" : "border-border bg-background hover:border-accent/60"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{option.label}</span>
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${unknown ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                      {unknown ? "custom" : option.source}
                    </span>
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-muted">{option.key}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-muted">{option.description}</span>
                </button>
              );
            })}
          </div>
          {unknownChecks.length > 0 ? (
            <div className="mt-2 rounded-ui border border-warning/30 bg-warning/10 p-2 text-xs leading-5 text-warning">
              Custom checks without a registered evidence skill: {unknownChecks.join(", ")}. These will remain missing until a custom worker reports them.
            </div>
          ) : null}
        </div>
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
