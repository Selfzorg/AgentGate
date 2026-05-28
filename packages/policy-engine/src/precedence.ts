import type { DemoPolicyRule } from "@agentgate/core-types";

const decisionPrecedence: Record<DemoPolicyRule["decision"], number> = {
  DENY: 4,
  FORCE_DRY_RUN: 3,
  REQUIRE_APPROVAL: 2,
  ALLOW: 1
};

export function sortPoliciesByPrecedence(rules: DemoPolicyRule[]): DemoPolicyRule[] {
  return [...rules].sort((left, right) => {
    const decisionOrder = decisionPrecedence[right.decision] - decisionPrecedence[left.decision];
    if (decisionOrder !== 0) return decisionOrder;
    return right.priority - left.priority;
  });
}
