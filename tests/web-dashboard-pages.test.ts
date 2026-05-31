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
    const skillRunPage = await readProjectFile("apps/web-dashboard/app/skill-runs/[runId]/page.tsx");
    const approvalCard = await readProjectFile("apps/web-dashboard/components/approvals/ApprovalCard.tsx");
    const evidenceMonitor = await readProjectFile("apps/web-dashboard/components/evidence/EvidenceMonitor.tsx");
    const executionConsole = await readProjectFile("apps/web-dashboard/components/execution/ExecutionConsole.tsx");

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

    expect(skillsRegistry).toContain("Create Review Snapshot");
    expect(skillsRegistry).toContain("Approve Selected");
    expect(skillsRegistry).toContain("Expected Evidence Tasks");
    expect(skillsRegistry).toContain("updateSkillEvidenceTasks");
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
    expect(approvalCard).toContain("Continue Execution");

    expect(riskScanner).toContain("Build Simulation Payload");
    expect(riskScanner).toContain("Simulate Policy");

    expect(executionConsole).toContain("<ExecutionStepRail");
    expect(executionConsole).toContain("<ExecutionNextStep");
    expect(executionFlow).toContain("Next: continue in Claude");
    expect(executionFlow).toContain("Claude completion callback");
  });
});
