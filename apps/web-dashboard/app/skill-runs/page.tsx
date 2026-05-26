import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";

export default function SkillRunsPage() {
  return (
    <div>
      <PageHeader
        title="Skill Runs"
        description="Decision replay now persists skill_runs. Detailed execution controls remain reserved for later phases."
      />
      <PlaceholderPanel title="Run index placeholder">
        Use Live Activity to replay fixture actions and open audit traces. A fuller skill run index arrives with approval and execution phases. Sample detail shell:{" "}
        <Link className="font-medium text-accent" href="/skill-runs/run_demo_placeholder">
          run_demo_placeholder
        </Link>
        .
      </PlaceholderPanel>
    </div>
  );
}
