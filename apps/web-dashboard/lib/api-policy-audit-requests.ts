import type { AuditEventRecord, AuditIntegrityRecord, PolicyRecord } from "./api-types";
import { apiBaseUrl } from "./api-config";

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

export async function getAuditIntegrityByTrace(traceId: string): Promise<{ audit_integrity: AuditIntegrityRecord }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/audit-integrity?trace_id=${encodeURIComponent(traceId)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load audit integrity: ${response.status}`);
  }

  return (await response.json()) as { audit_integrity: AuditIntegrityRecord };
}
