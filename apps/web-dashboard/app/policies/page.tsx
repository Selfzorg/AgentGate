import { PageHeader } from "@/components/shell/PageHeader";
import { PolicyViewer } from "@/components/policies/PolicyViewer";

export default function PoliciesPage() {
  return (
    <div>
      <PageHeader
        title="Policies"
        description="Policies are seeded from configs/demo-policies.yaml, evaluated by precedence in the API, and displayed here from persisted policy versions."
      />
      <PolicyViewer />
    </div>
  );
}
