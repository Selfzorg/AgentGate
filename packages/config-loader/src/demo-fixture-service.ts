import { join } from "node:path";
import { loadYamlFile } from "./load-yaml";
import {
  demoActionsConfigSchema,
  demoAgentsConfigSchema,
  demoGateChecksConfigSchema,
  demoPoliciesConfigSchema,
  demoSkillsConfigSchema,
  type DemoActionsConfig,
  type DemoAgentsConfig,
  type DemoGateChecksConfig,
  type DemoPoliciesConfig,
  type DemoSkillsConfig
} from "./validate-config";

export type DemoFixtureSet = {
  agents: DemoAgentsConfig;
  skills: DemoSkillsConfig;
  policies: DemoPoliciesConfig;
  actions: DemoActionsConfig;
  gateChecks: DemoGateChecksConfig;
};

export async function loadDemoFixtures(configDir: string): Promise<DemoFixtureSet> {
  const [agents, skills, policies, actions, gateChecks] = await Promise.all([
    loadYamlFile(join(configDir, "demo-agents.yaml")).then((value) =>
      demoAgentsConfigSchema.parse(value)
    ),
    loadYamlFile(join(configDir, "demo-skills.yaml")).then((value) =>
      demoSkillsConfigSchema.parse(value)
    ),
    loadYamlFile(join(configDir, "demo-policies.yaml")).then((value) =>
      demoPoliciesConfigSchema.parse(value)
    ),
    loadYamlFile(join(configDir, "demo-actions.yaml")).then((value) =>
      demoActionsConfigSchema.parse(value)
    ),
    loadYamlFile(join(configDir, "demo-gate-checks.yaml")).then((value) =>
      demoGateChecksConfigSchema.parse(value)
    )
  ]);

  return { agents, skills, policies, actions, gateChecks };
}
