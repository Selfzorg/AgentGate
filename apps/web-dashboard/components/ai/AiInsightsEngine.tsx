"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";
import {
  generateRunAiAnalysis,
  getRunAiAnalysis,
  type AiRunAnalysisRecord,
  type SkillRunDetailResponse
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";

type InsightTab = "summary" | "approval" | "failure";

export function AiInsightsEngine({
  runId,
  initialRun
}: {
  runId: string;
  initialRun?: SkillRunDetailResponse["skill_run"] | null;
}) {
  const [analysis, setAnalysis] = useState<AiRunAnalysisRecord | null>(initialRun?.ai_analysis ?? null);
  const [status, setStatus] = useState("Idle");
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<InsightTab>("summary");

  useEffect(() => {
    let cancelled = false;
    if (analysis) return;

    void getRunAiAnalysis(runId)
      .then((response) => {
        if (!cancelled) {
          setAnalysis(response.ai_analysis);
          setStatus(`${response.ai_analysis.status} · ${response.ai_analysis.model}`);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("No analysis yet");
      });

    return () => {
      cancelled = true;
    };
  }, [analysis, runId]);

  const tabs = useMemo(() => {
    const next: Array<{ id: InsightTab; label: string }> = [{ id: "summary", label: "Summary" }];
    if (initialRun?.approval_request?.status === "pending" || analysis?.approver_notes) {
      next.push({ id: "approval", label: "Approval" });
    }
    if (initialRun?.status === "failed" || analysis?.failure_cause) {
      next.push({ id: "failure", label: "Failure" });
    }
    return next;
  }, [analysis, initialRun]);

  async function handleGenerate() {
    setPending(true);
    setStatus("Generating");
    try {
      const response = await generateRunAiAnalysis(runId);
      setAnalysis(response.ai_analysis);
      setStatus(`${response.ai_analysis.status} · ${response.ai_analysis.model}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI analysis unavailable");
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="rounded-ui border border-border bg-surface p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <BrainCircuit className="h-4 w-4 text-accent" aria-hidden="true" />
            AI Insights Engine
          </h2>
          <p className="mt-1 text-xs text-muted">{status}</p>
        </div>
        <Button variant="secondary" disabled={pending} onClick={() => void handleGenerate()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {pending ? "Running" : "Run"}
        </Button>
      </div>

      <div className="mt-3 flex rounded-ui border border-border bg-background p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={`flex-1 rounded-ui px-2 py-1.5 text-xs font-medium ${
              tab === item.id ? "bg-surface text-foreground shadow-panel" : "text-muted"
            }`}
            type="button"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-[220px] text-sm leading-6">
        {analysis ? <InsightBody analysis={analysis} tab={tab} /> : <EmptyState />}
      </div>

      {analysis ? (
        <div className="mt-4 border-t border-border pt-3 text-xs text-muted">
          {analysis.status} · {analysis.total_tokens} tokens · {analysis.estimated_cost_cents} cents
        </div>
      ) : null}
    </aside>
  );
}

function InsightBody({ analysis, tab }: { analysis: AiRunAnalysisRecord; tab: InsightTab }) {
  if (tab === "approval") {
    return (
      <div>
        <h3 className="text-xs uppercase text-muted">Approver Notes</h3>
        <p className="mt-2">{analysis.approver_notes ?? "No approval-specific notes."}</p>
        <InsightList title="Missing Evidence" value={analysis.missing_evidence} />
      </div>
    );
  }

  if (tab === "failure") {
    return (
      <div>
        <h3 className="text-xs uppercase text-muted">Likely Cause</h3>
        <p className="mt-2">{analysis.failure_cause ?? "No failure cause detected."}</p>
        <InsightList title="Suggested Actions" value={analysis.suggested_actions} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs uppercase text-muted">Advisory Summary</h3>
        <span className="rounded-ui bg-background px-2 py-1 text-xs text-muted">{analysis.severity}</span>
      </div>
      <p className="mt-2">{analysis.summary}</p>
      <InsightList title="Risk Notes" value={analysis.risk_notes} />
      {analysis.error ? <p className="mt-3 text-xs text-danger">{analysis.error}</p> : null}
    </div>
  );
}

function InsightList({ title, value }: { title: string; value: unknown }) {
  const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  if (items.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs uppercase text-muted">{title}</h3>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item} className="rounded-ui border border-border bg-background px-3 py-2 text-xs leading-5">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return <p className="text-sm text-muted">No advisory analysis stored for this run.</p>;
}
