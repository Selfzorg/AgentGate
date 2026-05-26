export async function executeSkillRunPlaceholder(runId: string): Promise<{ runId: string; status: "pending" }> {
  return { runId, status: "pending" };
}
