import type { ExecutionToken } from "@prisma/client";
import { redactCommonSecrets } from "@agentgate/ai-provider";

type ExecutionEnvelopeInput = {
  run: {
    id: string;
    traceId: string;
    tenantId: string;
    workspaceId: string;
    source: string;
    adapterType: string;
    rawAction: string;
    environment: string | null;
    decision: string | null;
    riskLevel: string | null;
    riskScore: number | null;
    context: unknown;
    policySnapshot: unknown;
    resolvedSkillSnapshot: unknown;
    matchedPolicyRecordId?: string | null;
    approvalRequest?: {
      id: string;
      status: string;
      approvedAt: Date | null;
      approvedByUserId: string | null;
    } | null;
    agent?: {
      externalAgentId: string;
      agentType: string;
      role: string;
    } | null;
    skill?: {
      skillId: string;
      versions?: Array<{
        id: string;
        version: string;
        execution: unknown;
      }>;
    } | null;
  };
  skillId: string;
  executionToken: ExecutionToken | null;
  idempotencyKey: string;
  credentialMode: "bearer" | "legacy_token_id" | "not_required";
};

export function buildExecutionEnvelope(input: ExecutionEnvelopeInput) {
  const version = input.run.skill?.versions?.[0] ?? null;
  const scopes = Array.isArray(input.executionToken?.scopes)
    ? input.executionToken.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  return {
    version: "agentgate.execution_envelope.v1",
    issued_at: new Date().toISOString(),
    run_id: input.run.id,
    trace_id: input.run.traceId,
    tenant_id: input.run.tenantId,
    workspace_id: input.run.workspaceId,
    idempotency_key: input.idempotencyKey,
    source: input.run.source,
    adapter_type: input.run.adapterType,
    agent: input.run.agent
      ? {
          agent_id: input.run.agent.externalAgentId,
          agent_type: input.run.agent.agentType,
          role: input.run.agent.role
        }
      : null,
    skill: {
      skill_id: input.skillId,
      skill_version_id: version?.id ?? null,
      version: version?.version ?? null,
      resolved_snapshot: input.run.resolvedSkillSnapshot
    },
    approved_action: {
      raw_action: redactCommonSecrets(input.run.rawAction),
      environment: input.run.environment,
      context: redactJsonValue(input.run.context)
    },
    approval: input.run.approvalRequest
      ? {
          approval_id: input.run.approvalRequest.id,
          status: input.run.approvalRequest.status,
          approved_at: input.run.approvalRequest.approvedAt?.toISOString() ?? null,
          approved_by_user_id: input.run.approvalRequest.approvedByUserId
        }
      : null,
    token: input.executionToken
      ? {
          execution_token_id: input.executionToken.id,
          credential_mode: input.credentialMode,
          scopes,
          environment: input.executionToken.environment,
          expires_at: input.executionToken.expiresAt.toISOString()
        }
      : {
          execution_token_id: null,
          credential_mode: "not_required",
          scopes: [],
          environment: input.run.environment,
          expires_at: null
        },
    policy: {
      decision: input.run.decision,
      risk_level: input.run.riskLevel,
      risk_score: input.run.riskScore,
      matched_policy_record_id: input.run.matchedPolicyRecordId ?? null,
      policy_snapshot: input.run.policySnapshot
    },
    runtime: runtimePlanForSkill(input.skillId, input.run.source, input.run.adapterType, version?.execution),
    nested_hook_validation: {
      required_env: ["AGENTGATE_RUN_ID", "AGENTGATE_EXECUTION_TOKEN"],
      bind_to: ["run_id", "skill_id", "environment", "token.scopes"],
      raw_action_must_match_approved_envelope: true
    }
  };
}

function redactJsonValue(value: unknown) {
  try {
    return JSON.parse(redactCommonSecrets(JSON.stringify(value)));
  } catch {
    return "[REDACTED_UNSERIALIZABLE_CONTEXT]";
  }
}

function runtimePlanForSkill(skillId: string, source: string, adapterType: string, execution: unknown) {
  const executionConfig = execution && typeof execution === "object" ? (execution as Record<string, unknown>) : {};
  const configuredRuntime = typeof executionConfig.runtime === "string" ? executionConfig.runtime : null;
  const configuredConnector = typeof executionConfig.connector_id === "string" ? executionConfig.connector_id : null;
  const connector = configuredConnector ?? connectorForSkill(skillId);

  if (configuredRuntime) {
    return {
      adapter: configuredRuntime,
      connector,
      launch_mode: configuredRuntime.includes("cli") ? "headless_agent" : "in_process"
    };
  }

  return {
    adapter: "native_connector",
    connector,
    launch_mode: "in_process",
    requested_from: { source, adapter_type: adapterType },
    compatible_adapters: ["native_connector", "mcp_tool", "claude_cli", "codex_cli", "local_deterministic"]
  };
}

function connectorForSkill(skillId: string) {
  if (skillId === "deploy-production" || skillId === "deploy-staging") return "deployment-demo-connector";
  if (skillId === "run-db-migration" || skillId === "drop-table") return "db-demo-connector";
  return "github-demo-connector";
}
