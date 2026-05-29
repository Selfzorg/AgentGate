import { PageHeader } from "@/components/shell/PageHeader";
import { SkillsRegistry } from "@/components/skills/SkillsRegistry";

export default function SkillsPage() {
  return (
    <div>
      <PageHeader
        title="Skill Registry"
        description="Scan real Claude/Codex/MCP skills, review evidence and policy aliases, then publish versioned registry records."
      />
      <SkillsRegistry />
    </div>
  );
}
