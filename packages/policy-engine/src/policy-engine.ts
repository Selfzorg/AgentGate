import type { DemoPolicyRule } from "@agentgate/core-types";
import { sortPoliciesByPrecedence } from "./precedence";

export function selectFirstPolicyByPrecedence(rules: DemoPolicyRule[]): DemoPolicyRule | undefined {
  return sortPoliciesByPrecedence(rules)[0];
}
