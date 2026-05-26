const phaseZeroEvents = [
  "skill.invocation.received",
  "skill.classified",
  "risk.scored",
  "policy.evaluated",
  "audit.finalized"
];

export function AuditTimeline({ traceId }: { traceId: string }) {
  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <h2 className="text-base font-semibold">Timeline Shell</h2>
      <p className="mt-1 text-sm text-muted">Trace ID: {traceId}</p>
      <ol className="mt-5 space-y-3">
        {phaseZeroEvents.map((event) => (
          <li key={event} className="flex items-center gap-3 text-sm">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span>{event}</span>
            <span className="text-muted">reserved</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
