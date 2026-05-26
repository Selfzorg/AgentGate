import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";

export default function SkillsPage() {
  return (
    <div>
      <PageHeader
        title="Skill Registry"
        description="Seeded demo skills include tests, PR creation, merge, staging deploy, production deploy, database migration, and drop-table governance."
      />
      <PlaceholderPanel title="Seeded registry">
        Phase 0 seeds skills and versions into Postgres. The dashboard registry will query them through the API in Phase 1.
      </PlaceholderPanel>
    </div>
  );
}
