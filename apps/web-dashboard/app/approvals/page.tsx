import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { PageHeader } from "@/components/shell/PageHeader";

export default function ApprovalsPage() {
  return (
    <div>
      <PageHeader
        title="Approval Queue"
        description="Resolve evidence, approve governed actions, then continue execution from the run page."
      />
      <ApprovalCard />
    </div>
  );
}
