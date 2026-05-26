import type { Decision } from "./enums";

export type DemoPolicyRule = {
  policy_id: string;
  name: string;
  priority: number;
  when: Record<string, unknown>;
  decision: Decision;
  reason: string;
  required_checks?: string[] | undefined;
  approvers?: string[] | undefined;
};
