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
        description="Issue scoped execution tokens, queue governed execution, and stream persisted logs from the database."
      />
      <ExecutionConsole runId={runId} />
    </div>
  );
}
