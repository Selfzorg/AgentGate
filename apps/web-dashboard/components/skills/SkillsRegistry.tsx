"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Power, PowerOff, RefreshCw, Search, UploadCloud, XCircle } from "lucide-react";
import {
  approveSkillImportBatch,
  createSkillImport,
  getSkills,
  rejectSkillImportBatch,
  scanSkillRegistry,
  setSkillVersionStatus,
  type SkillImportBatch,
  type SkillRecord,
  type SkillRegistryScan
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SkillCandidateDetail } from "./SkillCandidateDetail";
import {
  defaultReviewDraft,
  evidenceCheckOptionsFromSkills,
  evidenceWarningsForChecks,
  inferPolicyAliasesForCandidate,
  inferredRequiredChecksForCandidate,
  rawRequiredEvidenceForCandidate,
  reviewDraftsForCandidates,
  sourceTypeFromSkill,
  warningCountForCandidate,
  type CandidateReviewDraft
} from "./import-review-helpers";
import { ImportNextStep, ImportStepRail, Metric, SourcePill, splitCsv } from "./skill-registry-ui";

export function SkillsRegistry() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
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
      const response = await getSkills({ includeInactive: true });
      setSkills(response.skills);
      setStatus(`${response.skills.length} skills loaded.`);
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
          policyAliases: splitCsv(candidateReviews[candidateId]?.policyAliases ?? "")
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
              value={rootDir}
              onChange={(event) => setRootDir(event.target.value)}
              placeholder="Current repository root"
              className="mt-1 h-10 w-full rounded-ui border border-border bg-background px-3 font-mono text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-ui border border-border bg-background px-3 text-sm">
            <input
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
                <input type="checkbox" checked={warningOnly} onChange={(event) => setWarningOnly(event.target.checked)} />
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
                  value={owners}
                  onChange={(event) => setOwners(event.target.value)}
                  className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
                />
              </label>
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Approvers</span>
                <input
                  value={approverRoles}
                  onChange={(event) => setApproverRoles(event.target.value)}
                  className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-3 text-sm outline-none focus:border-accent"
                />
              </label>
              <label>
                <span className="text-xs font-semibold uppercase text-muted">Comment</span>
                <input
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
            </article>
          ))}
          {skills.length === 0 ? <div className="p-5 text-sm text-muted">No skills loaded.</div> : null}
        </div>
      </section>
    </div>
  );
}
