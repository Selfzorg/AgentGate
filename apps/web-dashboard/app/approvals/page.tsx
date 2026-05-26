import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { PageHeader } from "@/components/shell/PageHeader";

export default function ApprovalsPage() {
  return (
    <div>
      <PageHeader
        title="Approval Queue"
        description="Approval packets, evidence, comments, deny, and force dry-run controls are implemented in Phase 2."
      />
      <ApprovalCard />
    </div>
  );
}
