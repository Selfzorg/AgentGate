import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";

export default function PoliciesPage() {
  return (
    <div>
      <PageHeader
        title="Policies"
        description="Policies are seeded from configs/demo-policies.yaml with precedence, decisions, required checks, and approver roles."
      />
      <PlaceholderPanel title="Policy viewer placeholder">
        The policy viewer will load seeded policy versions through the API in Phase 1. The UI is intentionally decoupled from policy evaluation code.
      </PlaceholderPanel>
    </div>
  );
}
