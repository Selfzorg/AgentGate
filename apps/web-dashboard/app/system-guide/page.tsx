import { SystemGuide } from "@/components/guide/SystemGuide";
import { PageHeader } from "@/components/shell/PageHeader";

export default function SystemGuidePage() {
  return (
    <div>
      <PageHeader
        title="System Guide"
        description="Functional map, user journeys, architecture, stack, APIs, and database relationships for AgentGate."
      />
      <SystemGuide />
    </div>
  );
}
