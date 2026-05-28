import type { ExecutionContext, ExecutionResult, SkillConnector, SkillInput, ValidationResult } from "@agentgate/connector-sdk";

export const deploymentDemoConnector: SkillConnector = {
  async validateInputs(_input: SkillInput): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  },
  async dryRun(_input: SkillInput, _context: ExecutionContext) {
    return { summary: "Deployment plan accepted.", artifacts: [] };
  },
  async execute(input: SkillInput, _context: ExecutionContext): Promise<ExecutionResult> {
    if (input.raw_action.includes("--simulate-failure") || input.context.simulate_failure === true) {
      return {
        status: "failed",
        summary: "Deployment simulation failed during rollout.",
        metadata: { reason: "simulated_failure" }
      };
    }

    return { status: "completed", summary: "Deployment simulation completed successfully." };
  }
};
