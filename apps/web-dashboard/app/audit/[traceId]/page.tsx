import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { PageHeader } from "@/components/shell/PageHeader";

export default async function AuditTracePage({
  params
}: {
  params: Promise<{ traceId: string }>;
}) {
  const { traceId } = await params;

  return (
    <div>
      <PageHeader
        title={`Audit Trace ${traceId}`}
        description="Persisted audit events show how AgentGate received, classified, scored, and evaluated the action."
      />
      <AuditTimeline traceId={traceId} />
    </div>
  );
}
