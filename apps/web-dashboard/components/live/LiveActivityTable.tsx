const columns = [
  "Time",
  "Agent",
  "Role",
  "Source",
  "Raw Action",
  "Skill",
  "Environment",
  "Risk",
  "Decision",
  "Trace"
];

export function LiveActivityTable() {
  return (
    <section className="overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
      <div className="border-b border-border p-5">
        <h2 className="text-base font-semibold">Activity Stream</h2>
        <p className="mt-1 text-sm text-muted">
          DB-backed activity rows start when Phase 1 persists skill_runs and audit_events.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full border-collapse text-left text-sm">
          <thead className="bg-background text-xs uppercase text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} className="border-b border-border px-4 py-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-8 text-muted" colSpan={columns.length}>
                No live records yet. Phase 0 is validating the foundation before product flow.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
