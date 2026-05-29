"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, KeyRound, Radio, ShieldCheck } from "lucide-react";
import {
  executeSkillRun,
  getSkillRun,
  getSkillRunLogsUrl,
  issueExecutionToken,
  type ExecutionLogRecord,
  type ExecutionTokenSummary,
  type SkillRunDetailResponse
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

export function ExecutionConsole({ runId }: { runId: string }) {
  const [run, setRun] = useState<SkillRunDetailResponse["skill_run"] | null>(null);
  const [token, setToken] = useState<ExecutionTokenSummary | null>(null);
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([]);
  const [status, setStatus] = useState("Loading execution state...");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const latestToken = useMemo(() => {
    if (!run) return null;
    const current = run.execution_tokens.find((candidate) => candidate.status === "issued") ?? run.execution_tokens[0];
    if (!current) return null;

    return {
      execution_token_id: current.id,
      skill_run_id: run.id,
      approval_id: current.approval_request_id,
      scopes: Array.isArray(current.scopes) ? current.scopes.filter((scope): scope is string => typeof scope === "string") : [],
      ttl_seconds: Math.max(0, Math.round((new Date(current.expires_at).getTime() - Date.now()) / 1000)),
      token_type: "agentgate_bearer",
      token_value_available: false,
      status: current.status,
      expires_at: current.expires_at
    } satisfies ExecutionTokenSummary;
  }, [run]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await getSkillRun(runId);
        if (!cancelled) {
          setRun(response.skill_run);
          setLogs(response.skill_run.execution_logs);
          setToken(summaryFromRun(response.skill_run));
          setStatus(`${response.skill_run.status} · ${response.skill_run.execution_logs.length} persisted logs`);
        }
      } catch {
        if (!cancelled) setStatus("Execution API unavailable.");
      }
    }

    void load();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
    };
  }, [runId]);

  useEffect(() => {
    if (!token && latestToken) setToken(latestToken);
  }, [latestToken, token]);

  async function reloadRun(nextStatus?: string) {
    const response = await getSkillRun(runId);
    setRun(response.skill_run);
    setLogs(response.skill_run.execution_logs);
    setToken(summaryFromRun(response.skill_run));
    setStatus(nextStatus ?? `${response.skill_run.status} · ${response.skill_run.execution_logs.length} persisted logs`);
  }

  async function handleIssueToken() {
    setPendingAction("Issue Execution Token");
    try {
      const approvalId = run?.approval_request?.id ?? null;
      const response = await issueExecutionToken(runId, approvalId);
      await reloadRun(`Token ${response.execution_token.status}: ${response.execution_token.execution_token_id}`);
      setToken(response.execution_token);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Token issuance failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleExecute() {
    setPendingAction("Execute Through AgentGate");
    try {
      const key = `ui-${runId}-${token?.execution_token_id ?? "no-token"}`;
      const response = await executeSkillRun(runId, {
        idempotency_key: key,
        ...(token?.token_value ? { execution_token: token.token_value } : token ? { execution_token_id: token.execution_token_id } : {})
      });
      openLogs();
      await reloadRun(`${response.status}: ${response.logs_url}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Execution failed.");
    } finally {
      setPendingAction(null);
    }
  }

  function openLogs() {
    eventSourceRef.current?.close();
    const source = new EventSource(getSkillRunLogsUrl(runId));
    eventSourceRef.current = source;
    setStatus("Live log stream open.");

    source.addEventListener("execution_log", (event) => {
      const data = JSON.parse(event.data) as Omit<ExecutionLogRecord, "id">;
      setLogs((current) => {
        if (current.some((log) => log.sequence === data.sequence)) return current;
        return [
          ...current,
          {
            id: `sse-${data.sequence}`,
            ...data
          }
        ].sort((left, right) => left.sequence - right.sequence);
      });
    });

    source.addEventListener("execution_completed", (event) => {
      const data = JSON.parse(event.data) as { status: string };
      setStatus(`Execution ${data.status}.`);
      source.close();
      void reloadRun(`Execution ${data.status}.`);
    });

    source.addEventListener("error", () => {
      setStatus("Live log stream closed.");
      source.close();
    });
  }

  const tokenRequired = run?.risk_level === "high" || run?.risk_level === "critical" || Boolean(run?.approval_request);
  const canIssueToken =
    !pendingAction &&
    Boolean(run) &&
    ["approved", "credential_issued", "policy_evaluated"].includes(run?.status ?? "") &&
    (!run?.approval_request || run.approval_request.status === "approved");
  const canExecute =
    !pendingAction &&
    Boolean(run) &&
    ["approved", "credential_issued", "policy_evaluated"].includes(run?.status ?? "") &&
    (!tokenRequired || Boolean(token?.execution_token_id));

  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold">Execution Console</h2>
          <p className="mt-1 text-sm text-muted">Run ID: {runId}</p>
          {run ? <p className="mt-1 font-mono text-xs text-muted">{run.raw_action}</p> : null}
        </div>
        <div className="flex max-w-full flex-col items-start gap-2 sm:items-end">
          <StatusBadge kind="run" value={run?.status ?? "loading"} />
          <StatusBadge kind="token" value={token?.status ?? "not_issued"} label={token ? `token ${token.status}` : "token not issued"} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-ui border border-border bg-background p-3">
          <div className="text-xs uppercase text-muted">Run Status</div>
          <div className="mt-2">
            <StatusBadge kind="run" value={run?.status ?? "loading"} />
          </div>
        </div>
        <div className="rounded-ui border border-border bg-background p-3">
          <div className="text-xs uppercase text-muted">Decision + Risk</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge kind="decision" value={run?.decision} />
            <StatusBadge kind="risk" value={run?.risk_level} />
          </div>
        </div>
        <div className="rounded-ui border border-border bg-background p-3">
          <div className="text-xs uppercase text-muted">Logs</div>
          <div className="mt-1 font-semibold">{logs.length} persisted</div>
        </div>
      </div>

      {token ? (
        <div className="mt-3 rounded-ui border border-border bg-background p-3 text-xs text-muted">
          Browser-visible token metadata only: <span className="font-mono">{token.execution_token_id}</span>. Raw token
          secret is never returned by the API.
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!canIssueToken} onClick={() => void handleIssueToken()}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {pendingAction === "Issue Execution Token" ? "Issuing" : "Issue Execution Token"}
        </Button>
        <Button variant="accent" disabled={!canExecute} onClick={() => void handleExecute()}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {pendingAction === "Execute Through AgentGate" ? "Queueing" : "Execute Through AgentGate"}
        </Button>
        <Button variant="secondary" disabled={!run} onClick={openLogs}>
          <Radio className="h-4 w-4" aria-hidden="true" />
          Open Live Logs
        </Button>
        {run ? (
          <Button asChild variant="ghost">
            <Link href={`/audit/${run.trace_id}`}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open Audit Trace
            </Link>
          </Button>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-muted">{status}</p>
      <div className="mt-5 overflow-hidden rounded-ui border border-border">
        <div className="border-b border-border bg-background px-3 py-2 text-xs uppercase text-muted">
          Execution Logs
        </div>
        <pre className="max-h-[360px] overflow-auto bg-foreground p-4 text-xs leading-6 text-background">
          {logs.length === 0
            ? "[logs] waiting for execution_logs rows"
            : logs.map((log) => `[${log.sequence}] ${log.level.toUpperCase()} ${log.message}`).join("\n")}
        </pre>
      </div>
    </section>
  );
}

function summaryFromRun(run: SkillRunDetailResponse["skill_run"]): ExecutionTokenSummary | null {
  const current = run.execution_tokens.find((candidate) => candidate.status === "issued") ?? run.execution_tokens[0];
  if (!current) return null;

  return {
    execution_token_id: current.id,
    skill_run_id: run.id,
    approval_id: current.approval_request_id,
    scopes: Array.isArray(current.scopes) ? current.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    ttl_seconds: Math.max(0, Math.round((new Date(current.expires_at).getTime() - Date.now()) / 1000)),
    token_type: "agentgate_bearer",
    token_value_available: false,
    status: current.status,
    expires_at: current.expires_at
  };
}
