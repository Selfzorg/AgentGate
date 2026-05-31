import { PageHeader } from "@/components/shell/PageHeader";
import { SkillRunIndex } from "@/components/skill-runs/SkillRunIndex";

export default function SkillRunsPage() {
  return (
    <div>
      <PageHeader
        title="Skill Runs"
        description="Search recent governed runs, inspect next actions, and jump to approvals, evidence, audit, or execution logs."
      />
      <SkillRunIndex />
    </div>
  );
}
