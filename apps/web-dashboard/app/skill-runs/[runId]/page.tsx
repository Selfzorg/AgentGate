import { AiInsightsEngine } from "@/components/ai/AiInsightsEngine";
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
        description="Follow the approved path: token, Claude handoff or connector execution, completion, logs, and audit."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ExecutionConsole runId={runId} />
        <AiInsightsEngine runId={runId} />
      </div>
    </div>
  );
}
