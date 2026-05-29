import type { AiRunAnalysisRecord, ClaudeHandoffResponse, DryRunResponse, ExecuteSkillRunResponse, IssueExecutionTokenResponse, SkillRunDetailResponse } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function runSkillRunDryRun(runId: string): Promise<DryRunResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/dry-run`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as DryRunResponse;
}

export async function getSkillRun(runId: string): Promise<SkillRunDetailResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load skill run: ${response.status}`);
  }

  return (await response.json()) as SkillRunDetailResponse;
}

export async function getRunAiAnalysis(runId: string): Promise<{ ai_analysis: AiRunAnalysisRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/ai-analysis`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load AI analysis: ${response.status}`);
  }

  return (await response.json()) as { ai_analysis: AiRunAnalysisRecord };
}

export async function generateRunAiAnalysis(runId: string): Promise<{ ai_analysis: AiRunAnalysisRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/ai-analysis`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { ai_analysis: AiRunAnalysisRecord };
}

export async function issueExecutionToken(
  runId: string,
  approvalId?: string | null
): Promise<IssueExecutionTokenResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/execution-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      skill_run_id: runId,
      ...(approvalId ? { approval_id: approvalId } : {}),
      include_token_value: true
    })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as IssueExecutionTokenResponse;
}

export async function executeSkillRun(
  runId: string,
  input: {
    execution_token_id?: string;
    execution_token?: string;
    idempotency_key: string;
  }
): Promise<ExecuteSkillRunResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ExecuteSkillRunResponse;
}

export async function createClaudeHandoff(runId: string): Promise<ClaudeHandoffResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skill-runs/${runId}/claude-handoff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_base_url: apiBaseUrl,
      requested_by: "agentgate-ui",
      ttl_seconds: 600
    })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ClaudeHandoffResponse;
}

export function getSkillRunLogsUrl(runId: string): string {
  return `${apiBaseUrl}/api/v1/skill-runs/${runId}/logs`;
}
