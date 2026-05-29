import type { PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "./audit-event-service";

export type BreakGlassInput = {
  runId: string;
  actorId?: string | undefined;
  reason?: string | undefined;
  severity?: "high" | "critical" | undefined;
};

export async function requestBreakGlass(prisma: PrismaClient, input: BreakGlassInput) {
  const reason = input.reason?.trim();
  if (!reason) {
    return { status: 400 as const, body: { error: "Break-glass requires a non-empty reason" } };
  }

  const run = await prisma.skillRun.findUnique({
    where: { id: input.runId }
  });
  if (!run) {
    return { status: 404 as const, body: { error: "Skill run not found" } };
  }

  const severity = input.severity ?? "critical";
  await emitAuditEvent(prisma, {
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    skillRunId: run.id,
    traceId: run.traceId,
    eventType: "break_glass.requested",
    actorType: "user",
    actorId: input.actorId ?? "unknown",
    metadata: {
      severity,
      reason,
      run_status: run.status,
      production_authority_granted: false,
      requires_out_of_band_incident_review: true
    }
  });

  return {
    status: 202 as const,
    body: {
      break_glass: {
        run_id: run.id,
        trace_id: run.traceId,
        severity,
        status: "recorded",
        production_authority_granted: false
      }
    }
  };
}
