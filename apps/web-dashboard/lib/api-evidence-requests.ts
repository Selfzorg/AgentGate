import type { ClearEvidenceQueueResponse, EvidenceMonitorResponse, EvidenceTaskActionResponse } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function getEvidenceMonitor(): Promise<EvidenceMonitorResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-monitor?tenant_id=tenant_demo&workspace_id=workspace_demo`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load evidence monitor: ${response.status}`);
  }

  return (await response.json()) as EvidenceMonitorResponse;
}

export async function prioritizeEvidenceTask(taskId: string): Promise<EvidenceTaskActionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-tasks/${encodeURIComponent(taskId)}/prioritize`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as EvidenceTaskActionResponse;
}

export async function clearActiveEvidenceQueue(): Promise<ClearEvidenceQueueResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-tasks/clear-active`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      workspace_id: "workspace_demo",
      reason: "Cleared from Evidence Monitor."
    })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ClearEvidenceQueueResponse;
}
