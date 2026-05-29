import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";

export default function AuditPage() {
  return (
    <div>
      <PageHeader
        title="Audit"
        description="Append-only audit search starts in Phase 1 and becomes a full lifecycle trace in Phase 3."
      />
      <PlaceholderPanel title="Trace search placeholder">
        Open a sample trace shell at{" "}
        <a className="font-medium text-accent" href="/audit/trc_demo_placeholder">
          trc_demo_placeholder
        </a>
        .
      </PlaceholderPanel>
    </div>
  );
}
