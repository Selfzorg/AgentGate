import { DemoActionLauncher } from "@/components/demo/DemoActionLauncher";
import { DemoJourneyRail } from "@/components/demo/DemoJourneyRail";
import { ReplayScenarioButton } from "@/components/demo/ReplayScenarioButton";
import { LiveActivityTable } from "@/components/live/LiveActivityTable";
import { PageHeader } from "@/components/shell/PageHeader";

export default function LivePage() {
  return (
    <div>
      <PageHeader
        title="Live Activity"
        description="Replay fixture-backed agent actions and watch actual persisted decision records appear from the API."
      />
      <DemoJourneyRail />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <LiveActivityTable />
        <div className="space-y-4">
          <ReplayScenarioButton />
          <DemoActionLauncher />
        </div>
      </div>
    </div>
  );
}
