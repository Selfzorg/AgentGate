import { PageHeader } from "@/components/shell/PageHeader";
import { RiskScannerPanel } from "@/components/risk-scanner/RiskScannerPanel";

export default function RiskScannerPage() {
  return (
    <div>
      <PageHeader
        title="Risk Scanner"
        description="Preview resolved skill, risk, policy, checks, and decision without creating governance records."
      />
      <RiskScannerPanel />
    </div>
  );
}
