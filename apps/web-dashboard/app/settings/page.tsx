import { PageHeader } from "@/components/shell/PageHeader";
import { PlaceholderPanel } from "@/components/shell/PlaceholderPanel";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Environment, branding, connector, and runtime settings are intentionally isolated from core governance logic."
      />
      <PlaceholderPanel title="Branding and runtime">
        Product name, navigation labels, and palette live in small theme files so the dashboard can be re-skinned later without changing backend contracts.
      </PlaceholderPanel>
    </div>
  );
}
