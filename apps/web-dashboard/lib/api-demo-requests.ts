import type { DemoActionsResponse, DemoContractResponse, DemoGoldenScenarioReplayResponse, DemoReplayResponse, DemoScenarioReplayResponse, LiveActivityResponse } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function getDemoActions(): Promise<DemoActionsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/demo/actions`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load demo actions: ${response.status}`);
  }

  return (await response.json()) as DemoActionsResponse;
}

export async function getDemoContract(): Promise<DemoContractResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/demo/contract`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load demo contract: ${response.status}`);
  }

  return (await response.json()) as DemoContractResponse;
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

export async function replayDemoGoldenScenario(scenarioId: string): Promise<DemoGoldenScenarioReplayResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/demo/scenarios/${encodeURIComponent(scenarioId)}/replay`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Failed to replay demo scenario ${scenarioId}: ${response.status}`);
  }

  return (await response.json()) as DemoGoldenScenarioReplayResponse;
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
