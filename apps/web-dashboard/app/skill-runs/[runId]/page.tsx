import { ExecutionConsole } from "@/components/execution/ExecutionConsole";
import { PageHeader } from "@/components/shell/PageHeader";

export default async function SkillRunDetailPage({
  params
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  return (
    <div>
      <PageHeader
        title={`Skill Run ${runId}`}
        description="Execution controls are visible as a Phase 0 shell. Token issuance and SSE logs start in Phase 3."
      />
      <ExecutionConsole runId={runId} />
    </div>
  );
}
