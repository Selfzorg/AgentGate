export type DemoActionCard = {
  id: string;
  label: string;
  description: string;
  expected_decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
  button_label: string;
  payload_preview: Record<string, unknown>;
};

export type DemoActionsResponse = {
  actions: DemoActionCard[];
};

export type DecisionResponse = {
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
  skill_id: string;
  skill_version: string;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_score: number;
  risk_reasons: string[];
  reason: string;
  trace_id: string;
  run_id: string;
  mode: "observe" | "enforce";
  dry_run_required?: boolean;
  missing_checks?: string[];
};

export type DemoReplayResponse = {
  action_id: string;
  decision: DecisionResponse;
};

export type DemoScenarioReplayResponse = {
  scenario: string;
  decisions: DemoReplayResponse[];
};

export type LiveActivity = {
  time: string;
  run_id: string;
  trace_id: string;
  agent_id: string | null;
  agent_display_name: string | null;
  role: string | null;
  source: string;
  raw_action: string;
  skill_id: string | null;
  environment: string | null;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  risk_score: number | null;
  decision: DecisionResponse["decision"] | null;
  status: string;
  reason: string | null;
  matched_policy_id: string | null;
};

export type LiveActivityResponse = {
  activities: LiveActivity[];
};

export type SkillRecord = {
  id: string;
  skill_id: string;
  name: string;
  category: string;
  default_risk_level: "low" | "medium" | "high" | "critical";
  description: string | null;
  version: string;
  connector: string | null;
  execution: Record<string, unknown>;
};

export type PolicyRecord = {
  id: string;
  policy_id: string;
  name: string;
  version: string;
  priority: number;
  decision: DecisionResponse["decision"];
  reason: string;
  definition: Record<string, unknown>;
  required_checks: unknown;
  approvers: unknown;
};

export type AuditEventRecord = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  skill_run_id: string | null;
  trace_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  sequence: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export async function getDemoActions(): Promise<DemoActionsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/demo/actions`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load demo actions: ${response.status}`);
  }

  return (await response.json()) as DemoActionsResponse;
}

export async function replayDemoAction(actionId: string): Promise<Response> {
  return fetch(`${apiBaseUrl}/api/v1/demo/actions/${actionId}/replay`, {
    method: "POST"
  });
}

export async function replayDemoActionJson(actionId: string): Promise<DemoReplayResponse> {
  const response = await replayDemoAction(actionId);

  if (!response.ok) {
    throw new Error(`Failed to replay demo action: ${response.status}`);
  }

  return (await response.json()) as DemoReplayResponse;
}

export async function replayDemoScenario(): Promise<DemoScenarioReplayResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/demo/scenario/replay`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Failed to replay demo scenario: ${response.status}`);
  }

  return (await response.json()) as DemoScenarioReplayResponse;
}

export async function getLiveActivity(): Promise<LiveActivityResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/live/activity`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load live activity: ${response.status}`);
  }

  return (await response.json()) as LiveActivityResponse;
}

export async function getSkills(): Promise<{ skills: SkillRecord[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skills`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load skills: ${response.status}`);
  }

  return (await response.json()) as { skills: SkillRecord[] };
}

export async function getPolicies(): Promise<{ policies: PolicyRecord[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/policies`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load policies: ${response.status}`);
  }

  return (await response.json()) as { policies: PolicyRecord[] };
}

export async function getAuditEventsByTrace(traceId: string): Promise<{ audit_events: AuditEventRecord[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/audit-events?trace_id=${encodeURIComponent(traceId)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load audit events: ${response.status}`);
  }

  return (await response.json()) as { audit_events: AuditEventRecord[] };
}
