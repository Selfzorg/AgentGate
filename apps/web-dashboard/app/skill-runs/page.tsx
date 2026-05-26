import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";

export default function SkillRunsPage() {
  return (
    <div>
      <PageHeader
        title="Skill Runs"
        description="The persisted run list will read from skill_runs after the Decision API lands in Phase 1."
      />
      <PlaceholderPanel title="Run index placeholder">
        No skill runs exist in Phase 0 seed data. Open a sample detail shell at{" "}
        <Link className="font-medium text-accent" href="/skill-runs/run_demo_placeholder">
          run_demo_placeholder
        </Link>
        .
      </PlaceholderPanel>
    </div>
  );
}
