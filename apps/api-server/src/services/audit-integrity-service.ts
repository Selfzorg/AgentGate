import type { AuditEvent, Prisma, PrismaClient, SkillRunStatus } from "@prisma/client";

export type AuditIntegrityInput = {
  traceId?: string | undefined;
  skillRunId?: string | undefined;
};

export async function validateAuditTrace(prisma: PrismaClient, input: AuditIntegrityInput) {
  const run = await prisma.skillRun.findFirst({
    where: {
      ...(input.skillRunId ? { id: input.skillRunId } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {})
    },
    include: {
      approvalRequest: true,
      dryRunResult: true,
      executionTokens: true,
      executionLogs: true,
      gateCheckResults: true,
      skillRunAttempts: true
    }
  });

  const traceId = run?.traceId ?? input.traceId;
  const skillRunId = run?.id ?? input.skillRunId;
  const eventWhere: Prisma.AuditEventWhereInput = {};
  if (traceId) eventWhere.traceId = traceId;
  if (skillRunId) eventWhere.skillRunId = skillRunId;

  const events = await prisma.auditEvent.findMany({
    where: eventWhere,
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }]
  });

  const requiredEvents = requiredEventsForRun(run);
  const observedEvents = events.map((event) => event.eventType);
  const missingEvents = requiredEvents.filter((eventType) => !observedEvents.includes(eventType));
  const sequence = validateAuditSequences(events);

  return {
    trace_id: traceId ?? events[0]?.traceId ?? null,
    skill_run_id: skillRunId ?? events.find((event) => event.skillRunId)?.skillRunId ?? null,
    complete: missingEvents.length === 0 && sequence.issues.length === 0,
    lifecycle_status: run?.status ?? null,
    required_events: requiredEvents,
    observed_events: observedEvents,
    missing_events: missingEvents,
    sequence,
    checked_at: new Date().toISOString()
  };
}

type AuditIntegrityRun = Prisma.SkillRunGetPayload<{
  include: {
    approvalRequest: true;
    dryRunResult: true;
    executionTokens: true;
    executionLogs: true;
    gateCheckResults: true;
    skillRunAttempts: true;
  };
}>;

function requiredEventsForRun(run: AuditIntegrityRun | null): string[] {
  const required = [
    "skill.invocation.received",
    "skill.classified",
    "risk.scored",
    "policy.evaluated"
  ];

  if (!run) return required;

  if (run.gateCheckResults.length > 0) required.push("prerequisites.checked");
  if (run.dryRunResult || run.status === "dry_run_completed") {
    required.push("dry_run.started", "dry_run.completed");
  }

  if (run.approvalRequest) {
    required.push("approval.requested");
    if (run.approvalRequest.status === "approved") required.push("approval.granted");
    if (run.approvalRequest.status === "denied") required.push("approval.denied");
  }

  if (run.executionTokens.length > 0) required.push("credential.issued");
  if (run.skillRunAttempts.length > 0 || executionStarted(run.status)) required.push("execution.queued");

  if (terminalExecution(run.status)) {
    required.push("execution.started", "execution.log_emitted");
    required.push(run.status === "failed" ? "execution.failed" : "execution.completed");
    required.push("audit.finalized");
  }

  return [...new Set(required)];
}

function executionStarted(status: SkillRunStatus): boolean {
  return ["execution_queued", "executing", "completed", "failed", "rolled_back", "audited"].includes(status);
}

function terminalExecution(status: SkillRunStatus): boolean {
  return ["completed", "failed", "rolled_back", "audited"].includes(status);
}

function validateAuditSequences(events: AuditEvent[]) {
  const issues: string[] = [];
  const values = events
    .map((event) => event.sequence)
    .filter((sequence): sequence is number => typeof sequence === "number");
  const nullSequenceEvents = events.filter((event) => event.sequence === null).map((event) => event.id);
  if (nullSequenceEvents.length > 0) {
    issues.push(`Events missing sequence: ${nullSequenceEvents.join(", ")}`);
  }

  const duplicateValues = values.filter((value, index) => values.indexOf(value) !== index);
  const duplicateSequences = [...new Set(duplicateValues)];
  if (duplicateSequences.length > 0) {
    issues.push(`Duplicate sequence values: ${duplicateSequences.join(", ")}`);
  }

  if (values.length > 0) {
    const sorted = [...values].sort((left, right) => left - right);
    const outOfOrder = values.some((value, index) => value !== sorted[index]);
    if (outOfOrder) issues.push("Audit event sequences are not monotonic.");

    const max = sorted[sorted.length - 1] ?? 0;
    const missing = Array.from({ length: max }, (_, index) => index + 1).filter(
      (expected) => !values.includes(expected)
    );
    if (missing.length > 0) issues.push(`Missing sequence values: ${missing.join(", ")}`);
  }

  return {
    event_count: events.length,
    complete: issues.length === 0,
    issues
  };
}
