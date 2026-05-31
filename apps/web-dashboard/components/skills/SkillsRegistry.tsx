"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Power, PowerOff, RefreshCw, Search, UploadCloud, XCircle } from "lucide-react";
import {
  approveSkillImportBatch,
  createSkillImport,
  getPolicies,
  getSkills,
  rejectSkillImportBatch,
  scanSkillRegistry,
  setSkillVersionStatus,
  updateSkillEvidenceTasks,
  updateSkillPolicyBindings,
  type EvidenceTaskSpec,
  type SkillImportBatch,
  type PolicyRecord,
  type SkillRecord,
  type SkillRegistryScan
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SkillCandidateDetail } from "./SkillCandidateDetail";
import {
  defaultReviewDraft,
  evidenceCheckOptionsFromSkills,
  evidenceSkillOptionsFromSkills,
  evidenceTasksFromSkill,
  evidenceWarningsForChecks,
  inferPolicyAliasesForCandidate,
  inferredRequiredChecksForCandidate,
  rawRequiredEvidenceForCandidate,
  reviewDraftsForCandidates,
  sourceTypeFromSkill,
  warningCountForCandidate,
  type CandidateReviewDraft,
  type EvidenceSkillOption
} from "./import-review-helpers";
import { ImportNextStep, ImportStepRail, Metric, SourcePill, splitCsv } from "./skill-registry-ui";

export function SkillsRegistry() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [scan, setScan] = useState<SkillRegistryScan | null>(null);
  const [batch, setBatch] = useState<SkillImportBatch | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [rootDir, setRootDir] = useState("");
  const [includeUserScopes, setIncludeUserScopes] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [warningOnly, setWarningOnly] = useState(false);
  const [owners, setOwners] = useState("service_owner");
  const [approverRoles, setApproverRoles] = useState("service_owner");
  const [comment, setComment] = useState("Imported skill owner review completed.");
  const [candidateReviews, setCandidateReviews] = useState<Record<string, CandidateReviewDraft>>({});
  const [status, setStatus] = useState("Loading skill registry...");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillEvidenceDrafts, setSkillEvidenceDrafts] = useState<Record<string, EvidenceTaskSpec[]>>({});
  const [editingPolicySkillId, setEditingPolicySkillId] = useState<string | null>(null);
  const [skillPolicyDrafts, setSkillPolicyDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadSkills();
  }, []);

  const candidates = useMemo(() => {
    if (batch?.candidates) return batch.candidates;
    return (
      scan?.candidates.map((candidate) => ({
        id: candidate.id,
        candidate_id: candidate.id,
        skill_id: candidate.skillId,
        name: candidate.name,
        description: candidate.description,
        source_type: candidate.sourceType,
        source_path: candidate.sourcePath,
        relative_path: candidate.relativePath,
        scope: candidate.scope,
        content_hash: candidate.contentHash,
        declared_tools: candidate.declaredTools,
        skill_type: candidate.skillType,
        side_effect_level: candidate.sideEffectLevel,
        default_risk_level: candidate.defaultRiskLevel,
        allowed_runtimes: candidate.allowedRuntimes,
        preferred_runtimes: candidate.preferredRuntimes,
        warnings: candidate.warnings,
        metadata: candidate.metadata,
        evidence_tasks: Array.isArray(candidate.metadata.evidence_tasks) ? (candidate.metadata.evidence_tasks as EvidenceTaskSpec[]) : [],
        inferred_policy_aliases: inferPolicyAliasesForCandidate(candidate),
        inferred_required_checks: inferredRequiredChecksForCandidate(candidate),
        required_evidence_raw: rawRequiredEvidenceForCandidate(candidate),
        evidence_warnings: evidenceWarningsForChecks(inferredRequiredChecksForCandidate(candidate), rawRequiredEvidenceForCandidate(candidate)),
        review_status: "preview",
        imported_skill_record_id: null,
        imported_skill_version_id: null,
        review_notes: {},
        created_at: scan.scannedAt,
        updated_at: scan.scannedAt
      })) ?? []
    );
  }, [batch, scan]);

  const filteredCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        if (sourceFilter !== "all" && candidate.source_type !== sourceFilter) return false;
        if (riskFilter !== "all" && candidate.default_risk_level !== riskFilter) return false;
        if (warningOnly && warningCountForCandidate(candidate) === 0) return false;
        return true;
      }),
    [candidates, riskFilter, sourceFilter, warningOnly]
  );

  const activeCandidate = candidates.find((candidate) => candidate.candidate_id === activeCandidateId) ?? filteredCandidates[0] ?? null;
  const sourceOptions = [...new Set(candidates.map((candidate) => candidate.source_type))].sort();
  const evidenceOptions = useMemo(() => evidenceCheckOptionsFromSkills(skills), [skills]);
  const evidenceSkillOptions = useMemo(() => evidenceSkillOptionsFromSkills(skills), [skills]);
  const policyTargets = useMemo(() => {
    const targets = policies
      .filter((policy) => policy.status !== "inactive")
      .flatMap((policy) => policyTargetKeys(policy))
      .filter(Boolean);
    return [...new Set(targets)].sort();
  }, [policies]);
  const selectedCount = selectedCandidateIds.length;
  const importStage = batch
    ? batch.status === "approved"
      ? "imported"
      : batch.status === "rejected"
        ? "rejected"
        : "review"
    : scan
      ? "scanned"
      : "start";

  async function loadSkills() {
    try {
      const [skillResponse, policyResponse] = await Promise.all([getSkills({ includeInactive: true }), getPolicies({ includeInactive: true })]);
      setSkills(skillResponse.skills);
      setPolicies(policyResponse.policies);
      setStatus(`${skillResponse.skills.length} skills and ${policyResponse.policies.length} policies loaded.`);
    } catch {
      setStatus("API unavailable.");
    }
  }

  async function runScan() {
    setPendingAction("scan");
    try {
      const trimmedRoot = rootDir.trim();
      const response = await scanSkillRegistry({
        ...(trimmedRoot ? { rootDir: trimmedRoot } : {}),
        includeUserScopes
      });
      setScan(response.scan);
      setBatch(null);
      setSelectedCandidateIds([]);
      setCandidateReviews({});
      setActiveCandidateId(response.scan.candidates[0]?.id ?? null);
      setStatus(`${response.scan.summary.total} candidates found, ${response.scan.summary.warningCount} warnings. Create a review snapshot to approve.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function createSnapshot() {
    setPendingAction("import");
    try {
      const trimmedRoot = rootDir.trim();
      const response = await createSkillImport({
        ...(trimmedRoot ? { rootDir: trimmedRoot } : {}),
        includeUserScopes
      });
      setScan(response.scan);
      setBatch(response.import_batch);
      const pendingIds = response.import_batch.candidates?.map((candidate) => candidate.candidate_id) ?? [];
      setSelectedCandidateIds(pendingIds);
      setCandidateReviews(reviewDraftsForCandidates(response.import_batch.candidates ?? []));
      setActiveCandidateId(pendingIds[0] ?? null);
      setStatus(`Review snapshot ${response.import_batch.id} created. Review evidence and approve selected candidates.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import snapshot failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function approveSelected() {
    if (!batch || selectedCandidateIds.length === 0) return;
    setPendingAction("approve");
    try {
      const response = await approveSkillImportBatch(batch.id, {
        candidateIds: selectedCandidateIds,
        candidateReviews: selectedCandidateIds.map((candidateId) => ({
          candidateId,
          requiredChecks: splitCsv(candidateReviews[candidateId]?.requiredChecks ?? ""),
          policyAliases: splitCsv(candidateReviews[candidateId]?.policyAliases ?? ""),
          evidenceTasks: candidateReviews[candidateId]?.evidenceTasks ?? []
        })),
        owners: splitCsv(owners),
        approverRoles: splitCsv(approverRoles),
        comment
      });
      setBatch(response.import_batch);
      setSelectedCandidateIds([]);
      setStatus(
        `${response.imported.length} imported, ${response.skipped.length} unchanged, ${response.disabled.length} disabled. Next: trigger the skill from Claude or test it in Risk Scanner.`
      );
      await loadSkills();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function rejectBatch() {
    if (!batch) return;
    setPendingAction("reject");
    try {
      const response = await rejectSkillImportBatch(batch.id, comment);
      setBatch(response.import_batch);
      setSelectedCandidateIds([]);
      setStatus(`Snapshot ${response.import_batch.id} rejected. Registry rows were not created.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Reject failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleVersion(skill: SkillRecord) {
    if (skill.version === "unknown") return;
    setPendingAction(`version:${skill.id}`);
    try {
      await setSkillVersionStatus(skill.id, skill.version, skill.version_status === "active" ? "disable" : "enable");
      await loadSkills();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Version update failed.");
    } finally {
      setPendingAction(null);
    }
  }

  function startSkillEvidenceEdit(skill: SkillRecord) {
    setEditingSkillId(skill.id);
    setSkillEvidenceDrafts((drafts) => ({
      ...drafts,
      [skill.id]: evidenceTasksFromSkill(skill)
    }));
  }

  function updateSkillEvidenceDraft(skillId: string, index: number, field: keyof EvidenceTaskSpec, value: string) {
    setSkillEvidenceDrafts((drafts) => ({
      ...drafts,
      [skillId]: (drafts[skillId] ?? []).map((task, taskIndex) => {
        if (taskIndex !== index) return task;
        if (field === "success_criteria" || field === "allowed_actions" || field === "target_files") {
          return { ...task, [field]: splitCsv(value) };
        }
        return { ...task, [field]: value };
      })
    }));
  }

  function attachSkillEvidenceDraft(skillId: string, index: number, evidenceSkillId: string) {
    const trimmedSkillId = evidenceSkillId.trim();
    const option = evidenceSkillOptions.find((candidate) => candidate.skill_id === trimmedSkillId);
    setSkillEvidenceDrafts((drafts) => ({
      ...drafts,
      [skillId]: (drafts[skillId] ?? []).map((task, taskIndex) => {
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
      })
    }));
  }

  function addSkillEvidenceDraft(skillId: string) {
    setSkillEvidenceDrafts((drafts) => {
      const current = drafts[skillId] ?? [];
      const nextIndex = current.length + 1;
      return {
        ...drafts,
        [skillId]: [
          ...current,
          {
            check_key: `custom_evidence_${nextIndex}`,
            label: `Custom evidence ${nextIndex}`,
            instructions: "Describe the read-only evidence the worker must collect.",
            success_criteria: [],
            allowed_actions: ["read_file"],
            target_files: []
          }
        ]
      };
    });
  }

  function removeSkillEvidenceDraft(skillId: string, index: number) {
    setSkillEvidenceDrafts((drafts) => ({
      ...drafts,
      [skillId]: (drafts[skillId] ?? []).filter((_, taskIndex) => taskIndex !== index)
    }));
  }

  async function saveSkillEvidenceTasks(skill: SkillRecord) {
    setPendingAction(`evidence:${skill.id}`);
    try {
      await updateSkillEvidenceTasks(skill.skill_id, skillEvidenceDrafts[skill.id] ?? []);
      setStatus(`Evidence tasks updated for ${skill.skill_id}. A new active skill version was created.`);
      setEditingSkillId(null);
      await loadSkills();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Evidence task update failed.");
    } finally {
      setPendingAction(null);
    }
  }

  function startSkillPolicyEdit(skill: SkillRecord) {
    setEditingPolicySkillId(skill.id);
    setSkillPolicyDrafts((drafts) => ({
      ...drafts,
      [skill.id]: (skill.policy_aliases ?? []).join(", ")
    }));
  }

  async function saveSkillPolicyBindings(skill: SkillRecord) {
    setPendingAction(`policy:${skill.id}`);
    try {
      const response = await updateSkillPolicyBindings(skill.skill_id, splitCsv(skillPolicyDrafts[skill.id] ?? ""));
      const suffix = response.noop ? "No new version was needed." : "A new active skill version was created.";
      const warningText = response.warnings?.length ? ` Warnings: ${response.warnings.join(" ")}` : "";
      setStatus(`Policy bindings updated for ${skill.skill_id}. ${suffix}${warningText}`);
      setEditingPolicySkillId(null);
      await loadSkills();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Policy binding update failed.");
    } finally {
      setPendingAction(null);
    }
  }

  function toggleCandidate(candidateId: string) {
    setSelectedCandidateIds((current) =>
      current.includes(candidateId) ? current.filter((id) => id !== candidateId) : [...current, candidateId]
    );
  }

  function selectFiltered() {
    setSelectedCandidateIds(filteredCandidates.filter((candidate) => candidate.review_status === "pending").map((candidate) => candidate.candidate_id));
  }

  return (
    <div className="space-y-5">
      <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1">
            <span className="text-xs font-semibold uppercase text-muted">Skill Root</span>
            <input
              suppressHydrationWarning
              value={rootDir}
              onChange={(event) => setRootDir(event.target.value)}
              placeholder="Current repository root"
              className="mt-1 h-10 w-full rounded-ui border border-border bg-background px-3 font-mono text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-ui border border-border bg-background px-3 text-sm">
            <input
              suppressHydrationWarning
              type="checkbox"
              checked={includeUserScopes}
              onChange={(event) => setIncludeUserScopes(event.target.checked)}
              className="h-4 w-4"
            />
            User scopes
          </label>
          <Button variant="secondary" disabled={pendingAction !== null} onClick={() => void runScan()}>
            {pendingAction === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Scan Skills
          </Button>
          <Button disabled={pendingAction !== null} onClick={() => void createSnapshot()}>
            {pendingAction === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Create Review Snapshot
          </Button>
          <Button variant="ghost" disabled={pendingAction !== null} onClick={() => void loadSkills()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Metric label="Candidates" value={String(scan?.summary.total ?? batch?.candidate_count ?? 0)} />
          <Metric label="Warnings" value={String(scan?.summary.warningCount ?? batch?.warning_count ?? 0)} />
          <Metric label="Duplicates" value={String(scan?.duplicateGroups.length ?? 0)} />
          <Metric label="Registry" value={String(skills.length)} />
        </div>
        <ImportStepRail stage={importStage} />
        <ImportNextStep stage={importStage} selectedCount={selectedCount} batchStatus={batch?.status ?? null} />
        <p className="mt-3 text-sm text-muted">{status}</p>
      </section>

      {candidates.length > 0 ? (
        <section className="overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
          <div className="border-b border-border p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Source</span>
                <select
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value)}
                  className="mt-1 h-9 rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                >
                  <option value="all">All</option>
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Risk</span>
                <select
                  value={riskFilter}
                  onChange={(event) => setRiskFilter(event.target.value)}
                  className="mt-1 h-9 rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                >
                  <option value="all">All</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label className="flex h-9 items-center gap-2 rounded-ui border border-border bg-background px-3 text-sm">
                <input suppressHydrationWarning type="checkbox" checked={warningOnly} onChange={(event) => setWarningOnly(event.target.checked)} />
                Warnings
              </label>
              <Button variant="secondary" disabled={!batch || pendingAction !== null} onClick={selectFiltered}>
                <CheckCircle2 className="h-4 w-4" />
                Select Pending Candidates
              </Button>
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-border bg-background text-xs uppercase text-muted">
                  <tr>
                    <th className="w-12 px-4 py-3">Pick</th>
                    <th className="px-4 py-3">Candidate</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Risk</th>
                    <th className="px-4 py-3">Side Effect</th>
                    <th className="px-4 py-3">Review</th>
                    <th className="px-4 py-3">Warnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredCandidates.map((candidate) => (
                    <tr
                      key={candidate.candidate_id}
                      className={activeCandidateId === candidate.candidate_id ? "bg-accent/5" : "bg-surface"}
                      onClick={() => setActiveCandidateId(candidate.candidate_id)}
                    >
                      <td className="px-4 py-3">
                        <input
                          suppressHydrationWarning
                          type="checkbox"
                          checked={selectedCandidateIds.includes(candidate.candidate_id)}
                          disabled={candidate.review_status !== "pending"}
                          title={candidate.review_status === "preview" ? "Create a review snapshot before selecting." : undefined}
                          onChange={() => toggleCandidate(candidate.candidate_id)}
                          onClick={(event) => event.stopPropagation()}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{candidate.name}</div>
                        <div className="mt-1 max-w-[320px] truncate font-mono text-xs text-muted">{candidate.skill_id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <SourcePill value={candidate.source_type} />
                        <div className="mt-1 font-mono text-xs text-muted">{candidate.scope}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge kind="risk" value={candidate.default_risk_level} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted">{candidate.side_effect_level}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge kind="gate" value={candidate.review_status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={warningCountForCandidate(candidate) > 0 ? "text-warning" : "text-muted"}>
                          {warningCountForCandidate(candidate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <SkillCandidateDetail
              candidate={activeCandidate}
              review={activeCandidate ? candidateReviews[activeCandidate.candidate_id] ?? defaultReviewDraft(activeCandidate) : null}
              editable={Boolean(batch && activeCandidate?.review_status === "pending")}
              evidenceOptions={evidenceOptions}
              evidenceSkillOptions={evidenceSkillOptions}
              onReviewChange={(candidateId, review) =>
                setCandidateReviews((current) => ({
                  ...current,
                  [candidateId]: review
                }))
              }
            />
          </div>

          <div className="border-t border-border p-5">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.4fr_auto_auto] lg:items-end">
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Owners</span>
                <input
                  suppressHydrationWarning
                  value={owners}
                  onChange={(event) => setOwners(event.target.value)}
                  className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
                />
              </label>
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Approvers</span>
                <input
                  suppressHydrationWarning
                  value={approverRoles}
                  onChange={(event) => setApproverRoles(event.target.value)}
                  className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
                />
              </label>
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Comment</span>
                <input
                  suppressHydrationWarning
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
                />
              </label>
              <Button disabled={!batch || selectedCount === 0 || pendingAction !== null} onClick={() => void approveSelected()}>
                {pendingAction === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve Selected {selectedCount}
              </Button>
              <Button variant="secondary" disabled={!batch || pendingAction !== null} onClick={() => void rejectBatch()}>
                {pendingAction === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Reject Snapshot
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
        <div className="border-b border-border p-5">
          <h2 className="text-base font-semibold">Skill Registry</h2>
          <p className="mt-1 text-sm text-muted">{skills.length} active or imported records returned by the API.</p>
        </div>
        <div className="grid gap-0 divide-y divide-border">
          {skills.map((skill) => (
            <article key={skill.id} className="grid gap-3 p-5 md:grid-cols-[1.4fr_1fr_auto_auto] md:items-center">
              <div>
                <h3 className="text-sm font-semibold">{skill.name}</h3>
                <p className="mt-1 font-mono text-xs text-muted">{skill.skill_id}</p>
              </div>
              <div className="text-sm text-muted">
                <div>{skill.category}</div>
                <div className="font-mono text-xs">{sourceTypeFromSkill(skill) ?? `connector ${skill.connector ?? "none"}`}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <StatusBadge kind="risk" value={skill.default_risk_level} />
                <StatusBadge kind="gate" value={skill.version_status} />
                <div className="font-mono text-xs text-muted">v{skill.version}</div>
              </div>
              <Button
                variant="secondary"
                disabled={skill.version === "unknown" || pendingAction === `version:${skill.id}`}
                onClick={() => void toggleVersion(skill)}
              >
                {pendingAction === `version:${skill.id}` ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : skill.version_status === "active" ? (
                  <PowerOff className="h-4 w-4" />
                ) : (
                  <Power className="h-4 w-4" />
                )}
                {skill.version_status === "active" ? "Disable" : "Enable"}
              </Button>
              <div className="md:col-span-4">
                <div className="rounded-ui border border-border bg-background p-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
                    <div>
                      <div className="text-xs font-semibold uppercase text-muted">What It Does</div>
                      <p className="mt-1 text-sm leading-6 text-muted">{skillWhatItDoes(skill)}</p>
                      <div className="mt-4 rounded-ui border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold uppercase text-muted">Policy Bindings</div>
                            <div className="mt-1 text-[11px] text-muted">Aliases connect this skill to policy when.skill targets.</div>
                          </div>
                          {editingPolicySkillId === skill.id ? (
                            <div className="flex items-center gap-2">
                              <Button variant="secondary" disabled={pendingAction === `policy:${skill.id}`} onClick={() => setEditingPolicySkillId(null)}>
                                Cancel
                              </Button>
                              <Button disabled={pendingAction === `policy:${skill.id}`} onClick={() => void saveSkillPolicyBindings(skill)}>
                                {pendingAction === `policy:${skill.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                Save Policy
                              </Button>
                            </div>
                          ) : (
                            <Button variant="secondary" disabled={pendingAction !== null} onClick={() => startSkillPolicyEdit(skill)}>
                              Edit Policy
                            </Button>
                          )}
                        </div>
                        {editingPolicySkillId === skill.id ? (
                          <label className="mt-3 block">
                            <span className="text-[10px] font-semibold uppercase text-muted">Policy Aliases</span>
                            <input
                              suppressHydrationWarning
                              value={skillPolicyDrafts[skill.id] ?? ""}
                              list={`policy-targets-${safeDomId(skill.id)}`}
                              placeholder="deploy-production, drop-table"
                              onChange={(event) => setSkillPolicyDrafts((drafts) => ({ ...drafts, [skill.id]: event.target.value }))}
                              className="mt-1 w-full rounded-ui border border-border bg-surface px-2 py-1 font-mono text-[11px] outline-none focus:border-accent"
                            />
                            <datalist id={`policy-targets-${safeDomId(skill.id)}`}>
                              {policyTargets.map((target) => (
                                <option key={target} value={target} />
                              ))}
                            </datalist>
                            <p className="mt-2 text-[11px] leading-5 text-muted">
                              Active targets: {policyTargets.join(", ") || "none"}
                            </p>
                          </label>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {(skill.policy_aliases ?? []).length > 0 ? (
                                (skill.policy_aliases ?? []).map((alias) => (
                                  <span key={alias} className="rounded-ui border border-border bg-surface px-2 py-1 font-mono text-[11px] text-muted">
                                    {alias}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted">No policy aliases.</span>
                              )}
                            </div>
                            <div className="text-[11px] leading-5 text-muted">
                              Matched Policies:{" "}
                              {(skill.matched_policies ?? []).length > 0
                                ? (skill.matched_policies ?? []).map((policy) => `${policy.policy_id} (${policy.decision})`).join(", ")
                                : "none"}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold uppercase text-muted">Expected Evidence Tasks</div>
                          <div className="mt-1 text-[11px] text-muted">Saved edits create a new active skill version.</div>
                        </div>
                        {editingSkillId === skill.id ? (
                          <div className="flex items-center gap-2">
                            <Button variant="secondary" disabled={pendingAction === `evidence:${skill.id}`} onClick={() => setEditingSkillId(null)}>
                              Cancel
                            </Button>
                            <Button disabled={pendingAction === `evidence:${skill.id}`} onClick={() => void saveSkillEvidenceTasks(skill)}>
                              {pendingAction === `evidence:${skill.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              Save Evidence
                            </Button>
                          </div>
                        ) : (
                          <Button variant="secondary" disabled={pendingAction !== null} onClick={() => startSkillEvidenceEdit(skill)}>
                            Edit Evidence
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 grid gap-2">
                        {(editingSkillId === skill.id ? skillEvidenceDrafts[skill.id] ?? [] : evidenceTasksFromSkill(skill)).map((task, index) => (
                          <div key={`${task.check_key}-${index}`} className="rounded-ui border border-border p-3">
                            {editingSkillId === skill.id ? (
                              <div className="grid gap-2">
                                <div className="grid gap-2 md:grid-cols-2">
                                  <EvidenceTaskField label="Check Key" value={task.check_key} onChange={(value) => updateSkillEvidenceDraft(skill.id, index, "check_key", value)} />
                                  <EvidenceTaskField label="Label" value={task.label} onChange={(value) => updateSkillEvidenceDraft(skill.id, index, "label", value)} />
                                </div>
                                <EvidenceSkillInput
                                  value={task.evidence_skill_id ?? ""}
                                  listId={`skill-evidence-skill-${skill.id}-${index}`}
                                  options={evidenceSkillOptions}
                                  onChange={(value) => attachSkillEvidenceDraft(skill.id, index, value)}
                                />
                                <EvidenceTaskField
                                  label="Instructions"
                                  value={task.instructions}
                                  onChange={(value) => updateSkillEvidenceDraft(skill.id, index, "instructions", value)}
                                  multiline
                                />
                                <div className="grid gap-2 md:grid-cols-3">
                                  <EvidenceTaskField
                                    label="Success Criteria"
                                    value={task.success_criteria.join(", ")}
                                    onChange={(value) => updateSkillEvidenceDraft(skill.id, index, "success_criteria", value)}
                                  />
                                  <EvidenceTaskField
                                    label="Allowed Actions"
                                    value={task.allowed_actions.join(", ")}
                                    placeholder="read_only, read_file, rg"
                                    onChange={(value) => updateSkillEvidenceDraft(skill.id, index, "allowed_actions", value)}
                                  />
                                  <EvidenceTaskField
                                    label="Target Files"
                                    value={task.target_files.join(", ")}
                                    onChange={(value) => updateSkillEvidenceDraft(skill.id, index, "target_files", value)}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeSkillEvidenceDraft(skill.id, index)}
                                  className="justify-self-start rounded-ui border border-border px-2 py-1 text-[11px] font-medium text-muted"
                                >
                                  Remove task
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="font-medium">{task.label}</div>
                                  <div className="font-mono text-[11px] text-muted">{task.check_key}</div>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-muted">{task.instructions}</p>
                                <div className="mt-2 font-mono text-[11px] text-muted">
                                  verifier: {task.evidence_skill_id ?? "inline"} - actions: {task.allowed_actions.join(", ") || "default"} - files: {task.target_files.join(", ") || "none"}
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                        {editingSkillId === skill.id ? (
                          <button
                            type="button"
                            onClick={() => addSkillEvidenceDraft(skill.id)}
                            className="rounded-ui border border-dashed border-border p-2 text-sm font-medium text-muted"
                          >
                            Add evidence task
                          </button>
                        ) : evidenceTasksFromSkill(skill).length === 0 ? (
                          <div className="rounded-ui border border-border p-2 text-sm text-muted">No structured evidence tasks.</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ))}
          {skills.length === 0 ? <div className="p-5 text-sm text-muted">No skills loaded.</div> : null}
        </div>
      </section>
    </div>
  );
}

function skillWhatItDoes(skill: SkillRecord) {
  const snapshot = recordFrom(skill.config.execution_snapshot);
  const body = typeof snapshot.body === "string" ? snapshot.body.trim() : "";
  if (body) return body.length > 260 ? `${body.slice(0, 260)}...` : body;
  return skill.description ?? "No behavior summary available.";
}

function policyTargetKeys(policy: PolicyRecord) {
  const skill = recordFrom(policy.when).skill;
  if (typeof skill === "string" && skill.trim().length > 0) return [skill.trim()];
  if (Array.isArray(skill)) return skill.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
  return [];
}

function safeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function EvidenceTaskField({
  label,
  value,
  multiline,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const className = "mt-1 w-full rounded-ui border border-border bg-surface px-2 py-1 font-mono text-[11px] outline-none focus:border-accent";
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase text-muted">{label}</span>
      {multiline ? (
        <textarea suppressHydrationWarning value={value} rows={3} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={className} />
      ) : (
        <input suppressHydrationWarning value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={className} />
      )}
    </label>
  );
}

function EvidenceSkillInput({
  value,
  listId,
  options,
  onChange
}: {
  value: string;
  listId: string;
  options: EvidenceSkillOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase text-muted">evidence_skill_id</span>
      <input
        suppressHydrationWarning
        value={value}
        list={listId}
        placeholder="verify-ci-status"
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-ui border border-border bg-surface px-2 py-1 font-mono text-[11px] outline-none focus:border-accent"
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

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
