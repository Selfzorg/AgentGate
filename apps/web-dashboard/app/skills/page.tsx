import { PageHeader } from "@/components/shell/PageHeader";
import { SkillsRegistry } from "@/components/skills/SkillsRegistry";

export default function SkillsPage() {
  return (
    <div>
      <PageHeader
        title="Skill Registry"
        description="Seeded demo skills are loaded through the API so the UI stays independent from resolver implementation details."
      />
      <SkillsRegistry />
    </div>
  );
}
