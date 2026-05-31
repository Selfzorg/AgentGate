import type { ClearEvidenceQueueResponse, EvidenceMonitorResponse, EvidenceTaskActionResponse } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function getEvidenceMonitor(
  options: {
    limit?: number;
    q?: string;
    task_id?: string;
    run_id?: string;
    trace_id?: string;
    check_key?: string;
    status?: string;
    runtime?: string;
  } = {}
): Promise<EvidenceMonitorResponse> {
  const params = new URLSearchParams({
    tenant_id: "tenant_demo",
    workspace_id: "workspace_demo"
  });
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-monitor?${params.toString()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load evidence monitor: ${response.status}`);
  }

  return (await response.json()) as EvidenceMonitorResponse;
}

export async function getEvidenceTask(taskId: string): Promise<EvidenceTaskActionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/evidence-tasks/${encodeURIComponent(taskId)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load evidence task: ${response.status}`);
  }

  return (await response.json()) as EvidenceTaskActionResponse;
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
