import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function readProjectFile(path: string) {
  return readFile(join(process.cwd(), path), "utf8");
}

async function collectTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectTsxFiles(path);
      return path.endsWith(".tsx") ? [path] : [];
    })
  );

  return files.flat();
}

describe("web dashboard page regressions", () => {
  it("keeps approval, evidence, and run detail pages wired to API-backed client components", async () => {
    const approvalsPage = await readProjectFile("apps/web-dashboard/app/approvals/page.tsx");
    const evidencePage = await readProjectFile("apps/web-dashboard/app/evidence/page.tsx");
    const skillRunsIndexPage = await readProjectFile("apps/web-dashboard/app/skill-runs/page.tsx");
    const auditIndexPage = await readProjectFile("apps/web-dashboard/app/audit/page.tsx");
    const skillRunPage = await readProjectFile("apps/web-dashboard/app/skill-runs/[runId]/page.tsx");
    const approvalCard = await readProjectFile("apps/web-dashboard/components/approvals/ApprovalCard.tsx");
    const evidenceMonitor = await readProjectFile("apps/web-dashboard/components/evidence/EvidenceMonitor.tsx");
    const executionConsole = await readProjectFile("apps/web-dashboard/components/execution/ExecutionConsole.tsx");
    const skillRunIndex = await readProjectFile("apps/web-dashboard/components/skill-runs/SkillRunIndex.tsx");
    const auditExplorer = await readProjectFile("apps/web-dashboard/components/audit/AuditExplorer.tsx");

    expect(approvalsPage).toContain("<ApprovalCard />");
    expect(approvalCard).toContain("getApprovals");
    expect(approvalCard).toContain("approveApproval");
    expect(approvalCard).toContain("denyApproval");
    expect(approvalCard).toContain("runSkillRunDryRun");
    expect(approvalCard).toContain("RelatedRunSearchResults");
    expect(approvalCard).toContain("response.related_runs");
    expect(approvalCard).toContain("href={`/skill-runs/${approval.skill_run.id}`}");
    expect(approvalCard).not.toContain("Link href={`/skill-runs/${approval.skill_run.id}`}");

    expect(evidencePage).toContain("<EvidenceMonitor />");
    expect(evidenceMonitor).toContain("getEvidenceMonitor");
    expect(evidenceMonitor).toContain("prioritizeEvidenceTask");
    expect(evidenceMonitor).toContain("href={`/skill-runs/${task.skill_run_id}`}");
    expect(evidenceMonitor).not.toContain("Link href={`/skill-runs/${task.skill_run_id}`}");

    expect(skillRunsIndexPage).toContain("<SkillRunIndex />");
    expect(skillRunsIndexPage).not.toContain("PlaceholderPanel");
    expect(skillRunIndex).toContain("getSkillRuns");
    expect(skillRunIndex).toContain("Latest 100 Runs");
    expect(skillRunIndex).toContain("href={`/evidence?run_id=${encodeURIComponent(run.id)}`}");
    expect(skillRunIndex).toContain("href={`/audit/${run.trace_id}`}");

    expect(auditIndexPage).toContain("<AuditExplorer />");
    expect(auditIndexPage).not.toContain("PlaceholderPanel");
    expect(auditExplorer).toContain("getAuditTraces");
    expect(auditExplorer).toContain("Recent Trace Groups");
    expect(auditExplorer).toContain("lifecycle.complete");

    expect(skillRunPage).toContain("<ExecutionConsole runId={runId} />");
    expect(skillRunPage).toContain("<AiInsightsEngine runId={runId} />");
    expect(executionConsole).toContain("getSkillRun(runId)");
    expect(executionConsole).toContain("issueExecutionToken");
    expect(executionConsole).toContain("createClaudeHandoff");
    expect(executionConsole).toContain("getSkillRunLogsUrl(runId)");
  });

  it("shows loading states instead of empty pages while browser API fetches are bootstrapping", async () => {
    const approvalCard = await readProjectFile("apps/web-dashboard/components/approvals/ApprovalCard.tsx");
    const evidenceMonitor = await readProjectFile("apps/web-dashboard/components/evidence/EvidenceMonitor.tsx");
    const executionConsole = await readProjectFile("apps/web-dashboard/components/execution/ExecutionConsole.tsx");
    const skillRunIndex = await readProjectFile("apps/web-dashboard/components/skill-runs/SkillRunIndex.tsx");
    const auditExplorer = await readProjectFile("apps/web-dashboard/components/audit/AuditExplorer.tsx");

    expect(approvalCard).toContain("const [loading, setLoading] = useState(true)");
    expect(approvalCard).toContain('loading ? "Loading approval packets" : "No approval packets found"');
    expect(approvalCard).toContain("Fetching approval packets from the AgentGate API.");

    expect(evidenceMonitor).toContain("const [monitor, setMonitor] = useState<EvidenceMonitorResponse | null>(null)");
    expect(evidenceMonitor).toContain('const [refreshing, setRefreshing] = useState(true)');
    expect(evidenceMonitor).toContain("if (!monitor)");
    expect(evidenceMonitor).toContain("Loading evidence queue...");

    expect(executionConsole).toContain('const [run, setRun] = useState<SkillRunDetailResponse["skill_run"] | null>(null)');
    expect(executionConsole).toContain("Loading execution state...");
    expect(executionConsole).toContain("Execution API unavailable.");
    expect(executionConsole).toContain("run state is still loading.");

    expect(skillRunIndex).toContain("Loading latest skill runs...");
    expect(skillRunIndex).toContain("No skill runs match the current filters.");
    expect(auditExplorer).toContain("Loading recent audit traces...");
    expect(auditExplorer).toContain("No audit traces match the current filters.");
  });

  it("uses document navigation so dashboard links do not depend on Next client fetch", async () => {
    const files = await collectTsxFiles(join(process.cwd(), "apps/web-dashboard"));
    const sources = await Promise.all(files.map(async (file) => ({ file, content: await readFile(file, "utf8") })));
    const nextLinkImports = sources
      .filter(({ content }) => content.includes('from "next/link"') || content.includes("from 'next/link'"))
      .map(({ file }) => file.replace(process.cwd(), ""));

    expect(nextLinkImports).toEqual([]);

    const approvalCard = await readProjectFile("apps/web-dashboard/components/approvals/ApprovalCard.tsx");
    const evidenceMonitor = await readProjectFile("apps/web-dashboard/components/evidence/EvidenceMonitor.tsx");
    expect(approvalCard).toContain("<a href={`/skill-runs/${approval.skill_run.id}`}>");
    expect(evidenceMonitor).toContain("<a href={`/skill-runs/${task.skill_run_id}`}>");
  });

  it("keeps next-step guidance visible across import, approval, simulation, and execution flows", async () => {
    const skillsRegistry = await readProjectFile("apps/web-dashboard/components/skills/SkillsRegistry.tsx");
    const skillCandidateDetail = await readProjectFile("apps/web-dashboard/components/skills/SkillCandidateDetail.tsx");
    const importReviewHelpers = await readProjectFile("apps/web-dashboard/components/skills/import-review-helpers.ts");
    const skillRegistryUi = await readProjectFile("apps/web-dashboard/components/skills/skill-registry-ui.tsx");
    const approvalCard = await readProjectFile("apps/web-dashboard/components/approvals/ApprovalCard.tsx");
    const riskScanner = await readProjectFile("apps/web-dashboard/components/risk-scanner/RiskScannerPanel.tsx");
    const executionConsole = await readProjectFile("apps/web-dashboard/components/execution/ExecutionConsole.tsx");
    const executionFlow = await readProjectFile("apps/web-dashboard/components/execution/ExecutionFlow.tsx");
    const lifecycleTimeline = await readProjectFile("apps/web-dashboard/components/lifecycle/LifecycleTimeline.tsx");
    const statusBadge = await readProjectFile("apps/web-dashboard/components/ui/status-badge.tsx");

    expect(skillsRegistry).toContain("Create Review Snapshot");
    expect(skillsRegistry).toContain("Approve Selected");
    expect(skillsRegistry).toContain("Expected Evidence Tasks");
    expect(skillsRegistry).toContain("updateSkillEvidenceTasks");
    expect(skillsRegistry).toContain("Policy Bindings");
    expect(skillsRegistry).toContain("updateSkillPolicyBindings");
    expect(skillsRegistry).toContain("matched_policies");
    expect(skillsRegistry).toContain("Search Skills");
    expect(skillsRegistry).toContain("filteredSkills");
    expect(skillsRegistry).toContain("skillSearchText");
    expect(skillsRegistry).toContain("No skills match");
    expect(skillsRegistry).toContain("What It Does");
    expect(skillsRegistry).toContain("evidenceCheckOptionsFromSkills");
    expect(skillsRegistry).toContain("evidence_skill_id");
    expect(skillsRegistry).toContain("verify-ci-status");
    expect(skillsRegistry).toContain("evidenceSkillOptionsFromSkills");
    expect(skillCandidateDetail).toContain("Evidence Options");
    expect(skillCandidateDetail).toContain("Expected Evidence Tasks");
    expect(skillCandidateDetail).toContain("evidence_skill_id");
    expect(skillCandidateDetail).toContain("Custom checks without a registered evidence skill");
    expect(importReviewHelpers).toContain("backup_exists");
    expect(importReviewHelpers).toContain("evidenceCheckOptionsFromSkills");
    expect(skillRegistryUi).toContain("Next: create a review snapshot");
    expect(skillRegistryUi).toContain("Next: trigger or simulate the imported skill");

    expect(approvalCard).toContain("<ApprovalNextStep");
    expect(approvalCard).toContain("<ApprovalStepRail");
    expect(approvalCard).toContain("Continue Execution");
    expect(approvalCard).toContain("View Evidence");
    expect(approvalCard).toContain("Start Dry-Run");

    expect(riskScanner).toContain("Build Simulation Payload");
    expect(riskScanner).toContain("Simulate Policy");

    expect(executionConsole).toContain("<ExecutionStepRail");
    expect(executionConsole).toContain("<ExecutionNextStep");
    expect(executionConsole).toContain("<LifecycleTimeline");
    expect(executionFlow).toContain("Next: continue in Claude");
    expect(executionFlow).toContain("Claude completion callback");
    expect(lifecycleTimeline).toContain("Governance events, evidence work, and execution logs");
    expect(statusBadge).toContain("running: \"border-cyan-300/30");
    expect(statusBadge).toContain("missing: \"border-orange-300/30");
  });

  it("keeps the policies page wired to the versioned policy editor API", async () => {
    const policyViewer = await readProjectFile("apps/web-dashboard/components/policies/PolicyViewer.tsx");
    const policyRequests = await readProjectFile("apps/web-dashboard/lib/api-policy-audit-requests.ts");
    const button = await readProjectFile("apps/web-dashboard/components/ui/button.tsx");

    expect(policyViewer).toContain("Policy Editor");
    expect(policyViewer).toContain("when.skill");
    expect(policyViewer).toContain("dry_run_completed");
    expect(policyViewer).toContain("upsertPolicy");
    expect(policyViewer).toContain("setPolicyStatus");
    expect(policyViewer).toContain("suppressHydrationWarning");
    expect(policyViewer).toContain("Search Policies");
    expect(policyViewer).toContain("policySearchText");
    expect(policyViewer).toContain("filteredPolicies");
    expect(policyViewer).toContain("policySearchHaystack");
    expect(policyViewer).toContain("editingPolicyId");
    expect(policyViewer).toContain("scrollIntoView");
    expect(policyViewer).toContain("Save Policy");
    expect(policyViewer).toContain("Save Policy Version");
    expect(policyViewer).toContain("Cancel Edit");
    expect(policyViewer).toContain("Enable");
    expect(policyViewer).toContain("Disable");

    expect(policyRequests).toContain("POST");
    expect(policyRequests).toContain("/api/v1/policies");
    expect(policyRequests).toContain('status: "enable" | "disable"');
    expect(policyRequests).toContain("${encodeURIComponent(policyId)}/${status}");

    expect(button).toContain('type={asChild ? undefined : type ?? "button"}');
  });
});
