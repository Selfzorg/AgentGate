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

export type DemoContractResponse = {
  contract: {
    version: number;
    summary: string;
    modes: Array<{
      id: "without_agentgate" | "observe" | "enforce";
      label: string;
      description: string;
    }>;
  };
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
  mode: "observe" | "warn" | "enforce";
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
  executions?: Array<{
    action_id: string;
    step: string;
    result: unknown;
  }>;
  runner?: {
    scanned: number;
    claimed: number;
  };
};

export type DemoGoldenScenarioReplayResponse = {
  scenario: {
    scenario_id: string;
    run_id: string;
    trace_id: string;
    decision: DecisionResponse["decision"];
    final_status: string;
    steps: Array<{ name: string; status: string; detail?: unknown }>;
    audit_events: string[];
    log_messages: string[];
  };
};

export type LiveActivity = {
  time: string;
  updated_at?: string;
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
  latest_audit_event?: {
    event_type: string;
    sequence: number | null;
    created_at: string;
  } | null;
};

export type LiveActivityResponse = {
  activities: LiveActivity[];
};
