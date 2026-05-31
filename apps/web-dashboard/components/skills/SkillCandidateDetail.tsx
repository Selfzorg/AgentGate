import type { SkillImportCandidate } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  defaultReviewDraft,
  evidenceTasksForCandidate,
  evidenceWarningsForChecks,
  knownEvidenceChecks,
  uniqueStrings,
  type CandidateReviewDraft,
  type EvidenceCheckOption,
  type EvidenceSkillOption
} from "./import-review-helpers";
import { SourcePill, splitCsv } from "./skill-registry-ui";

export function SkillCandidateDetail({
  candidate,
  review,
  editable,
  evidenceOptions,
  evidenceSkillOptions,
  onReviewChange
}: {
  candidate: SkillImportCandidate | null;
  review: CandidateReviewDraft | null;
  editable: boolean;
  evidenceOptions: EvidenceCheckOption[];
  evidenceSkillOptions: EvidenceSkillOption[];
  onReviewChange: (candidateId: string, review: CandidateReviewDraft) => void;
}) {
  if (!candidate) {
    return <aside className="border-t border-border p-5 text-sm text-muted lg:border-l lg:border-t-0">No candidate selected.</aside>;
  }

  const activeReview = review ?? defaultReviewDraft(candidate);
  const evidenceTasks = activeReview.evidenceTasks ?? evidenceTasksForCandidate(candidate);
  const reviewedChecks = splitCsv(activeReview.requiredChecks);
  const reviewedAliases = splitCsv(activeReview.policyAliases);
  const unknownChecks = reviewedChecks.filter((check) => !knownEvidenceChecks.has(check));
  const evidenceWarnings = [
    ...(candidate.evidence_warnings ?? []),
    ...evidenceWarningsForChecks(
      reviewedChecks.filter((check) => !evidenceTasks.some((task) => task.check_key === check)),
      candidate.required_evidence_raw ?? []
    )
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

  function setEvidenceTasks(nextTasks: typeof evidenceTasks) {
    onReviewChange(candidate!.candidate_id, {
      ...activeReview,
      evidenceTasks: nextTasks,
      requiredChecks: uniqueStrings([
        ...nextTasks.map((task) => task.check_key),
        ...reviewedChecks.filter((check) => !evidenceTasks.some((task) => task.check_key === check))
      ]).join(", ")
    });
  }

  function updateEvidenceTask(index: number, field: keyof (typeof evidenceTasks)[number], value: string) {
    const nextTasks = evidenceTasks.map((task, taskIndex) => {
      if (taskIndex !== index) return task;
      if (field === "success_criteria" || field === "allowed_actions" || field === "target_files") {
        return { ...task, [field]: splitCsv(value) };
      }
      return { ...task, [field]: value };
    });
    setEvidenceTasks(nextTasks);
  }

  function attachEvidenceSkill(index: number, evidenceSkillId: string) {
    const trimmedSkillId = evidenceSkillId.trim();
    const option = evidenceSkillOptions.find((candidate) => candidate.skill_id === trimmedSkillId);
    const nextTasks = evidenceTasks.map((task, taskIndex) => {
      if (taskIndex !== index) return task;
      if (!trimmedSkillId) {
        const { evidence_skill_id: _evidenceSkillId, ...inlineTask } = task;
        return inlineTask;
      }
      if (!option) return { ...task, evidence_skill_id: trimmedSkillId };
      return {
        ...task,
        evidence_skill_id: option.skill_id,
        check_key: option.check_key,
        label: option.name,
        instructions: ""
      };
    });
    setEvidenceTasks(nextTasks);
  }

  function addEvidenceTask() {
    const nextIndex = evidenceTasks.length + 1;
    setEvidenceTasks([
      ...evidenceTasks,
      {
        check_key: `custom_evidence_${nextIndex}`,
        label: `Custom evidence ${nextIndex}`,
        instructions: "Describe the read-only evidence the worker must collect.",
        success_criteria: [],
        allowed_actions: ["read_file"],
        target_files: []
      }
    ]);
  }

  function removeEvidenceTask(index: number) {
    setEvidenceTasks(evidenceTasks.filter((_, taskIndex) => taskIndex !== index));
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
        <div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold uppercase text-muted">Expected Evidence Tasks</div>
              <div className="mt-1 text-[11px] leading-5 text-muted">
                These structured tasks are imported into the skill version and sent to the evidence worker.
              </div>
            </div>
            <button
              type="button"
              disabled={!editable}
              onClick={addEvidenceTask}
              className="rounded-ui border border-border px-2 py-1 text-[11px] font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add
            </button>
          </div>
          <div className="mt-2 grid gap-2">
            {evidenceTasks.map((task, index) => (
              <div key={`${task.check_key}-${index}`} className="rounded-ui border border-border bg-background p-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <EvidenceInput label="Check Key" value={task.check_key} disabled={!editable} onChange={(value) => updateEvidenceTask(index, "check_key", value)} />
                  <EvidenceInput label="Label" value={task.label} disabled={!editable} onChange={(value) => updateEvidenceTask(index, "label", value)} />
                </div>
                <EvidenceSkillInput
                  value={task.evidence_skill_id ?? ""}
                  disabled={!editable}
                  listId={`candidate-evidence-skill-${candidate.candidate_id}-${index}`}
                  options={evidenceSkillOptions}
                  onChange={(value) => attachEvidenceSkill(index, value)}
                />
                <EvidenceInput
                  label="Instructions"
                  value={task.instructions}
                  disabled={!editable}
                  onChange={(value) => updateEvidenceTask(index, "instructions", value)}
                  multiline
                />
                <div className="grid gap-2 md:grid-cols-3">
                  <EvidenceInput
                    label="Success Criteria"
                    value={task.success_criteria.join(", ")}
                    disabled={!editable}
                    onChange={(value) => updateEvidenceTask(index, "success_criteria", value)}
                  />
                  <EvidenceInput
                    label="Allowed Actions"
                    value={task.allowed_actions.join(", ")}
                    disabled={!editable}
                    placeholder="read_only, read_file, rg"
                    onChange={(value) => updateEvidenceTask(index, "allowed_actions", value)}
                  />
                  <EvidenceInput
                    label="Target Files"
                    value={task.target_files.join(", ")}
                    disabled={!editable}
                    onChange={(value) => updateEvidenceTask(index, "target_files", value)}
                  />
                </div>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => removeEvidenceTask(index)}
                  className="mt-2 rounded-ui border border-border px-2 py-1 text-[11px] font-medium text-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove task
                </button>
              </div>
            ))}
            {evidenceTasks.length === 0 ? (
              <div className="rounded-ui border border-border bg-background p-2 text-xs text-muted">No structured evidence tasks declared.</div>
            ) : null}
          </div>
        </div>
        <label>
          <span className="font-semibold uppercase text-muted">Required Checks</span>
          <span className="mt-1 block text-[11px] font-normal normal-case leading-5 text-muted">
            Pick registered evidence checks below, or type a custom key. Custom keys stay blocking until a worker can satisfy them.
          </span>
          <input
            suppressHydrationWarning
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
            suppressHydrationWarning
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

function EvidenceSkillInput({
  value,
  disabled,
  listId,
  options,
  onChange
}: {
  value: string;
  disabled: boolean;
  listId: string;
  options: EvidenceSkillOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-2 block">
      <span className="font-semibold uppercase text-muted">evidence_skill_id</span>
      <input
        suppressHydrationWarning
        value={value}
        disabled={disabled}
        list={listId}
        placeholder="verify-ci-status"
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-ui border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.skill_id} value={option.skill_id}>
            {option.name} ({option.check_key})
          </option>
        ))}
      </datalist>
    </label>
  );
}

function EvidenceInput({
  label,
  value,
  disabled,
  multiline,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const className =
    "mt-1 w-full rounded-ui border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <label className="mt-2 block">
      <span className="font-semibold uppercase text-muted">{label}</span>
      {multiline ? (
        <textarea
          suppressHydrationWarning
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className={className}
        />
      ) : (
        <input
          suppressHydrationWarning
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        />
      )}
    </label>
  );
}
