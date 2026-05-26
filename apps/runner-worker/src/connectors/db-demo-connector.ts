import type { ExecutionContext, ExecutionResult, SkillConnector, SkillInput, ValidationResult } from "@agentgate/connector-sdk";

export const dbDemoConnector: SkillConnector = {
  async validateInputs(_input: SkillInput): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  },
  async dryRun(_input: SkillInput, _context: ExecutionContext) {
    return {
      summary: "Schema diff generated. 2 tables altered, 1 index added.",
      artifacts: [{ type: "schema_diff", artifact_id: "artifact_schema_diff_001" }]
    };
  },
  async execute(_input: SkillInput, _context: ExecutionContext): Promise<ExecutionResult> {
    return { status: "completed", summary: "Database demo execution placeholder." };
  }
};
