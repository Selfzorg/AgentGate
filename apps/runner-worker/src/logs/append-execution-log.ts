export type ExecutionLogInput = {
  skillRunId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
};

export async function appendExecutionLogPlaceholder(input: ExecutionLogInput): Promise<ExecutionLogInput> {
  return input;
}
