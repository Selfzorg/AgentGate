import { PageHeader } from "@/components/shell/PageHeader";
import { AuditExplorer } from "@/components/audit/AuditExplorer";

export default function AuditPage() {
  return (
    <div>
      <PageHeader
        title="Audit"
        description="Explore recent traces, filter lifecycle events, and verify completeness before or after execution."
      />
      <AuditExplorer />
    </div>
  );
}
