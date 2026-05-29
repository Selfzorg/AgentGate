import { runDemoScenario, type DemoScenarioId } from "../apps/demo-agent-harness/src/run-demo-scenario";

const scenarioId = (process.argv[2] ?? "merge_pr_with_agentgate") as DemoScenarioId;
const apiBaseUrl = process.env.AGENTGATE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

try {
  const result = await runDemoScenario(scenarioId, { apiBaseUrl });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Demo scenario failed.");
  process.exitCode = 1;
}
