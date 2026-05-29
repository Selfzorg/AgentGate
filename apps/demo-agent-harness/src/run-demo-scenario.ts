import { requestJson, type DemoHarnessOptions } from "./send-demo-action";

export type DemoScenarioId =
  | "merge_pr_with_agentgate"
  | "production_deploy_with_agentgate"
  | "production_db_migration_with_agentgate"
  | "deny_destructive_action"
  | "retry_failed_execution";

export type DemoScenarioRun = {
  scenario: {
    scenario_id: DemoScenarioId;
    run_id: string;
    trace_id: string;
    decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
    final_status: string;
    steps: Array<{ name: string; status: string; detail?: unknown }>;
    audit_events: string[];
    log_messages: string[];
  };
};

export async function runDemoScenario(
  scenarioId: DemoScenarioId = "merge_pr_with_agentgate",
  options: DemoHarnessOptions = {}
): Promise<DemoScenarioRun> {
  return (await requestJson(options, `/api/v1/demo/scenarios/${encodeURIComponent(scenarioId)}/replay`, {})) as DemoScenarioRun;
}
