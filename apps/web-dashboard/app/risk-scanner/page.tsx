import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";

export default function RiskScannerPage() {
  return (
    <div>
      <PageHeader
        title="Risk Scanner"
        description="Risk scoring rules are scaffolded for later implementation against normalized action requests."
      />
      <PlaceholderPanel title="Scanner placeholder">
        Paste-and-score behavior starts after the Phase 1 resolver and risk engine are wired to the API.
      </PlaceholderPanel>
    </div>
  );
}
