import type { SkillInput } from "@agentgate/core-types";

export type { SkillInput } from "@agentgate/core-types";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export type ExecutionContext = {
  skill_run_id: string;
  trace_id: string;
  metadata: Record<string, unknown>;
};

export type DryRunResult = {
  summary: string;
  artifacts: Array<Record<string, unknown>>;
};

export type ExecutionResult = {
  status: "completed" | "failed";
  summary: string;
  metadata?: Record<string, unknown>;
};

export type RollbackResult = {
  status: "rolled_back" | "failed";
  summary: string;
};

export interface SkillConnector {
  validateInputs(input: SkillInput): Promise<ValidationResult>;
  dryRun(input: SkillInput, context: ExecutionContext): Promise<DryRunResult>;
  execute(input: SkillInput, context: ExecutionContext): Promise<ExecutionResult>;
  rollback?(input: SkillInput, context: ExecutionContext): Promise<RollbackResult>;
}
