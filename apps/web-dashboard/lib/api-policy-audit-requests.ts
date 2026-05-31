import type { AuditEventRecord, AuditIntegrityRecord, AuditTraceResponse, PolicyRecord } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function getPolicies(options: { includeInactive?: boolean } = {}): Promise<{ policies: PolicyRecord[] }> {
  const params = new URLSearchParams();
  if (options.includeInactive) params.set("include_inactive", "true");
  const response = await fetch(`${apiBaseUrl}/api/v1/policies${params.size > 0 ? `?${params.toString()}` : ""}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load policies: ${response.status}`);
  }

  return (await response.json()) as { policies: PolicyRecord[] };
}

export type PolicyEditorInput = {
  policy_id: string;
  name: string;
  priority: number;
  decision: PolicyRecord["decision"];
  reason: string;
  when: Record<string, unknown>;
  required_checks?: string[];
  approvers?: string[];
};

export async function upsertPolicy(input: PolicyEditorInput): Promise<{ policy: PolicyRecord; warnings?: string[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/policies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { policy: PolicyRecord; warnings?: string[] };
}

export async function setPolicyStatus(policyId: string, status: "enable" | "disable"): Promise<{ policy: PolicyRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/policies/${encodeURIComponent(policyId)}/${status}`, {
    method: "POST",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { policy: PolicyRecord };
}

export async function getAuditTraces(
  options: { limit?: number; q?: string; run_id?: string; trace_id?: string; event_type?: string } = {}
): Promise<AuditTraceResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = await fetch(`${apiBaseUrl}/api/v1/audit-traces${params.size ? `?${params.toString()}` : ""}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load audit traces: ${response.status}`);
  }

  return (await response.json()) as AuditTraceResponse;
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

export async function getAuditIntegrityByTrace(traceId: string): Promise<{ audit_integrity: AuditIntegrityRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/audit-integrity?trace_id=${encodeURIComponent(traceId)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load audit integrity: ${response.status}`);
  }

  return (await response.json()) as { audit_integrity: AuditIntegrityRecord };
}
