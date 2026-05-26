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
        description="Phase 0 reserves the trace route and timeline component. Persisted audit events start in Phase 1."
      />
      <AuditTimeline traceId={traceId} />
    </div>
  );
}
