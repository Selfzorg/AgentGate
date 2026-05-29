import type { ExecutionTokenStatus, LogLevel } from "./enums";

export type ExecutionTokenSummary = {
  execution_token_id: string;
  skill_run_id: string;
  scopes: string[];
  ttl_seconds: number;
  token_type: "agentgate_bearer";
  token_value_available: boolean;
  token_value?: string;
  status: ExecutionTokenStatus;
  expires_at: string;
};

export type ExecutionLogEvent = {
  sequence: number;
  level: LogLevel;
  message: string;
  created_at: string;
};
