import { EvidenceMonitor } from "@/components/evidence/EvidenceMonitor";
import { PageHeader } from "@/components/shell/PageHeader";

export default function EvidencePage() {
  return (
    <div>
      <PageHeader
        title="Evidence Monitor"
        description="Queue, worker heartbeat, task status, and evidence audit events for Claude/Codex policy checks."
      />
      <EvidenceMonitor />
    </div>
  );
}
