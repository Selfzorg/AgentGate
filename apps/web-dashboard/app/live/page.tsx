import { DemoActionLauncher } from "@/components/demo/DemoActionLauncher";
import { ReplayScenarioButton } from "@/components/demo/ReplayScenarioButton";
import { LiveActivityTable } from "@/components/live/LiveActivityTable";
import { PageHeader } from "@/components/shell/PageHeader";

export default function LivePage() {
  return (
    <div>
      <PageHeader
        title="Live Activity"
        description="Phase 0 loads demo action fixtures through the API. Decision replay and live activity persistence start in Phase 1."
      />
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
