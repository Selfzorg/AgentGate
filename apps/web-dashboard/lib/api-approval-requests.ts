import type { ApprovalActionResponse, ApprovalQueueResponse, ApprovalRecord, DryRunResponse, EvidenceRetryResponse } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function getApprovals(
  options: { limit?: number; offset?: number; status?: ApprovalRecord["status"]; q?: string } = {}
): Promise<ApprovalQueueResponse> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  if (options.status) query.set("status", options.status);
  if (options.q) query.set("q", options.q);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals${suffix}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load approvals: ${response.status}`);
  }

  return (await response.json()) as ApprovalQueueResponse;
}

export async function approveApproval(approvalId: string, comment: string): Promise<ApprovalActionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ApprovalActionResponse;
}

export async function denyApproval(approvalId: string, comment: string): Promise<ApprovalActionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}/deny`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ApprovalActionResponse;
}

export async function forceDryRun(approvalId: string): Promise<DryRunResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}/force-dry-run`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as DryRunResponse;
}

export async function retryApprovalEvidence(approvalId: string, checkKey?: string): Promise<EvidenceRetryResponse> {
  const suffix = checkKey ? `/evidence/${encodeURIComponent(checkKey)}/retry` : "/evidence/retry";
  const response = await fetch(`${apiBaseUrl}/api/v1/approvals/${approvalId}${suffix}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as EvidenceRetryResponse;
}
