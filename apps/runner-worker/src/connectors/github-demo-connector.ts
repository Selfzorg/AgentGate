import type { ExecutionContext, ExecutionResult, SkillConnector, SkillInput, ValidationResult } from "@agentgate/connector-sdk";

export const githubDemoConnector: SkillConnector = {
  async validateInputs(_input: SkillInput): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  },
  async dryRun(_input: SkillInput, _context: ExecutionContext) {
    return { summary: "GitHub demo dry-run placeholder.", artifacts: [] };
  },
  async execute(_input: SkillInput, _context: ExecutionContext): Promise<ExecutionResult> {
    return { status: "completed", summary: "GitHub demo execution placeholder." };
  }
};
