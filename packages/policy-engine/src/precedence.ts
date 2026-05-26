import type { DemoPolicyRule } from "@agentgate/core-types";

export function sortPoliciesByPrecedence(rules: DemoPolicyRule[]): DemoPolicyRule[] {
  return [...rules].sort((left, right) => right.priority - left.priority);
}
