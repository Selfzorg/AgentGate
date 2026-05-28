import { describe, expect, it } from "vitest";
import {
  type ClaudeEvidenceWorkerConfig,
  buildEvidencePrompt,
  commandSpecFor,
  configFromEnv,
  parseAgentOutput,
  runWorkerLoop,
  runWorkerOnce
} from "../scripts/claude-evidence-worker";

const baseTask = {
  id: "evtsk_test",
  tenant_id: "tenant_demo",
  workspace_id: "workspace_demo",
  skill_run_id: "run_test",
  trace_id: "trc_test",
  check_key: "ci_passed",
  label: "CI passed",
  runtime: "claude_code_mcp",
  status: "queued",
  attempt: 1,
  input: {
    instruction: "Verify CI passed.",
    evidence_skill: {
      skill_id: "verify-ci-status",
      side_effect_level: "read_only"
    }
  }
};

describe("Claude evidence worker", () => {
  it("claims a queued task and submits agent evidence", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const config = testConfig();
    const fetchImpl = fakeFetch(calls);

    const result = await runWorkerOnce(config, {
      fetchImpl,
      writeLog: async () => {},
      runAgentEvidence: async () => ({
        status: "passed",
        reason: "CI passed in the latest local evidence check.",
        evidence: {
          inspected: ["git status"]
        }
      })
    });

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/evidence-workers/heartbeat",
      "GET /api/v1/evidence-tasks",
      "POST /api/v1/evidence-tasks/evtsk_test/claim",
      "POST /api/v1/evidence-workers/heartbeat",
      "POST /api/v1/evidence-tasks/evtsk_test/complete",
      "POST /api/v1/evidence-workers/heartbeat"
    ]);
    expect(calls.at(-1)?.body).toMatchObject({
      agent_id: "claude_test_worker",
      status: "idle",
      processed_delta: 1
    });
    expect(calls[4]?.body).toMatchObject({
      agent_id: "claude_test_worker",
      status: "passed",
      reason: "CI passed in the latest local evidence check."
    });
  });

  it("processes multiple claimed evidence tasks concurrently when configured", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const tasks = [
      { ...baseTask, id: "evtsk_parallel_a", check_key: "ci_passed", label: "CI passed" },
      { ...baseTask, id: "evtsk_parallel_b", check_key: "rollback_plan_exists", label: "Rollback plan exists" }
    ];
    let activeAgents = 0;
    let maxActiveAgents = 0;

    const result = await runWorkerOnce(
      { ...testConfig(), limit: 2, maxTasksPerTick: 2, concurrency: 2 },
      {
        fetchImpl: fakeFetchForTasks(calls, tasks),
        writeLog: async () => {},
        runAgentEvidence: async (task) => {
          activeAgents += 1;
          maxActiveAgents = Math.max(maxActiveAgents, activeAgents);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeAgents -= 1;
          return {
            status: "passed",
            reason: `${task.label} passed.`,
            evidence: {}
          };
        }
      }
    );

    expect(result).toEqual({ scanned: 2, claimed: 2, completed: 2, failed: 0, skipped: 0 });
    expect(maxActiveAgents).toBe(2);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("POST /api/v1/evidence-tasks/evtsk_parallel_a/complete");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("POST /api/v1/evidence-tasks/evtsk_parallel_b/complete");
  });

  it("fails the evidence task when the agent runner errors", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const result = await runWorkerOnce({ ...testConfig(), fallbackToLocalDeterministic: false }, {
      fetchImpl: fakeFetch(calls),
      writeLog: async () => {},
      runAgentEvidence: async () => {
        throw new Error("agent command failed");
      }
    });

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 0, failed: 1, skipped: 0 });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("POST /api/v1/evidence-tasks/evtsk_test/fail");
    expect(calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_test/fail")?.body).toMatchObject({
      agent_id: "claude_test_worker",
      reason: "agent command failed"
    });
    expect(calls.at(-1)?.body).toMatchObject({
      agent_id: "claude_test_worker",
      status: "idle",
      failed_delta: 1
    });
  });

  it("falls back to local deterministic evidence after a technical agent failure", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const result = await runWorkerOnce({ ...testConfig(), driver: "claude" }, {
      fetchImpl: fakeFetch(calls),
      writeLog: async () => {},
      runAgentEvidence: async () => {
        throw new Error("Evidence agent output did not contain JSON.");
      }
    });

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    const completeBody = calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_test/complete")?.body;
    expect(completeBody).toMatchObject({
      agent_id: "claude_test_worker",
      status: "passed",
      evidence: {
        source: "local_deterministic_fallback",
        fallback_from_runtime: "claude_code_mcp",
        fallback_from_driver: "claude"
      }
    });
  });

  it("skips tasks that another worker already claimed", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const result = await runWorkerOnce(testConfig(), {
      fetchImpl: fakeFetch(calls, { claimStatus: 409 }),
      writeLog: async () => {},
      runAgentEvidence: async () => {
        throw new Error("should not run");
      }
    });

    expect(result).toEqual({ scanned: 1, claimed: 0, completed: 0, failed: 0, skipped: 1 });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/evidence-workers/heartbeat",
      "GET /api/v1/evidence-tasks",
      "POST /api/v1/evidence-tasks/evtsk_test/claim"
    ]);
  });

  it("continues processing when worker heartbeat reporting is unavailable", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const result = await runWorkerOnce(testConfig(), {
      fetchImpl: fakeFetch(calls, { heartbeatStatus: 500 }),
      writeLog: async () => {},
      runAgentEvidence: async () => ({
        status: "passed",
        reason: "Tests passed even though heartbeat reporting failed.",
        evidence: {}
      })
    });

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("POST /api/v1/evidence-workers/heartbeat");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("POST /api/v1/evidence-tasks/evtsk_test/complete");
  });

  it("treats an already-completed task as success when completion acknowledgement races", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const result = await runWorkerOnce(testConfig(), {
      fetchImpl: fakeFetch(calls, { completeStatus: 504, terminalTaskStatus: "succeeded" }),
      writeLog: async () => {},
      runAgentEvidence: async () => ({
        status: "passed",
        reason: "Tests passed before the completion response timed out.",
        evidence: {}
      })
    });

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("GET /api/v1/evidence-tasks/evtsk_test");
    expect(calls.map((call) => `${call.method} ${call.path}`)).not.toContain("POST /api/v1/evidence-tasks/evtsk_test/fail");
  });

  it("keeps the daemon loop alive after a transient API failure", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    let listAttempts = 0;
    let stopChecks = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: url.pathname, body });

      if (url.pathname === "/api/v1/evidence-workers/heartbeat" && method === "POST") {
        return jsonResponse({ evidence_worker: { id: "evw_test", status: body.status } });
      }
      if (url.pathname === "/api/v1/evidence-workers/claude_test_worker/stop" && method === "POST") {
        return jsonResponse({ evidence_worker: { id: "evw_test", status: "offline" } });
      }
      if (url.pathname === "/api/v1/evidence-tasks" && method === "GET") {
        listAttempts += 1;
        if (listAttempts === 1) return jsonResponse({ error: "temporary outage" }, 500);
        return jsonResponse({ evidence_tasks: [] });
      }
      return jsonResponse({ error: "unexpected request" }, 500);
    }) as typeof fetch;

    await runWorkerLoop(
      { ...testConfig(), intervalMs: 1 },
      () => {
        stopChecks += 1;
        return stopChecks > 3;
      },
      {
        fetchImpl,
        writeLog: async () => {}
      }
    );

    expect(listAttempts).toBeGreaterThanOrEqual(2);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("POST /api/v1/evidence-workers/heartbeat");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain("POST /api/v1/evidence-workers/claude_test_worker/stop");
  });

  it("parses direct and Claude wrapped JSON evidence output", () => {
    const direct = parseAgentOutput(
      JSON.stringify({
        status: "missing",
        reason: "CI evidence was not found.",
        evidence: { inspected: [] }
      })
    );
    expect(direct.status).toBe("missing");

    const wrapped = parseAgentOutput(
      JSON.stringify({
        result: JSON.stringify({
          status: "passed",
          reason: "CI passed.",
          evidence: { workflow: "ci" }
        })
      })
    );
    expect(wrapped).toEqual({
      status: "passed",
      reason: "CI passed.",
      evidence: { workflow: "ci" }
    });

    const fencedWrapped = parseAgentOutput(
      JSON.stringify({
        result: '```json\n{"status":"passed","reason":"Rollback plan exists.","evidence":{"file":"docs/runbook.md"}}\n```'
      })
    );
    expect(fencedWrapped).toEqual({
      status: "passed",
      reason: "Rollback plan exists.",
      evidence: { file: "docs/runbook.md" }
    });
  });

  it("builds a read-only prompt with forbidden side effects", () => {
    const prompt = buildEvidencePrompt(baseTask);
    expect(prompt).toContain("read-only evidence worker");
    expect(prompt).toContain("Do not deploy");
    expect(prompt).toContain("\"check_key\": \"ci_passed\"");
  });

  it("runs Claude evidence jobs in bare mode with explicit repo access", () => {
    const config = {
      ...testConfig(),
      driver: "claude" as const,
      workspaceDir: "/tmp/agentgate"
    };
    const command = commandSpecFor(config);

    expect(command.command).toBe("claude");
    expect(command.args).toContain("--bare");
    expect(command.args).toContain("--add-dir");
    expect(command.args[command.args.indexOf("--add-dir") + 1]).toBe("/tmp/agentgate");
    expect(command.args).toContain("--allowedTools");
    expect(command.args).toContain("--disallowedTools");
    expect(config.allowedTools).not.toContain("Bash(pnpm test*)");
    expect(config.disallowedTools).toContain("Bash(*deploy*)");
    expect(config.disallowedTools).toContain("Bash(pnpm test*)");
  });
});

function testConfig(): ClaudeEvidenceWorkerConfig {
  return {
    ...configFromEnv(
      {
        ...process.env,
        AGENTGATE_API_BASE_URL: "http://agentgate.test",
        AGENTGATE_TENANT_ID: "tenant_demo",
        AGENTGATE_WORKSPACE_ID: "workspace_demo",
        AGENTGATE_EVIDENCE_WORKER_AGENT_ID: "claude_test_worker",
        AGENTGATE_EVIDENCE_AGENT_DRIVER: "demo"
      },
      process.cwd()
    ),
    limit: 1,
    maxTasksPerTick: 1,
    heartbeatMs: 10000,
    agentTimeoutMs: 1000,
    apiTimeoutMs: 1000,
    logPath: "/tmp/agentgate-test-claude-worker.jsonl"
  };
}

function fakeFetch(
  calls: Array<{ method: string; path: string; body: unknown }>,
  options: { claimStatus?: number; heartbeatStatus?: number; completeStatus?: number; terminalTaskStatus?: string } = {}
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === "/api/v1/evidence-workers/heartbeat" && method === "POST") {
      return jsonResponse(
        {
          evidence_worker: {
            id: "evw_test",
            agent_id: "claude_test_worker",
            status: body.status,
            effective_status: body.status
          }
        },
        options.heartbeatStatus ?? 200
      );
    }

    if (url.pathname === "/api/v1/evidence-tasks" && method === "GET") {
      return jsonResponse({ evidence_tasks: [baseTask] });
    }

    if (url.pathname === "/api/v1/evidence-tasks/evtsk_test" && method === "GET") {
      return jsonResponse({
        evidence_task: {
          ...baseTask,
          status: options.terminalTaskStatus ?? "claimed",
          claimed_by_agent_id: "claude_test_worker"
        }
      });
    }

    if (url.pathname === "/api/v1/evidence-tasks/evtsk_test/claim" && method === "POST") {
      if (options.claimStatus) {
        return jsonResponse({ error: "Evidence task is not claimable" }, options.claimStatus);
      }
      return jsonResponse({
        evidence_task: {
          ...baseTask,
          status: "claimed",
          claimed_by_agent_id: "claude_test_worker"
        }
      });
    }

    if (url.pathname === "/api/v1/evidence-tasks/evtsk_test/complete" && method === "POST") {
      return jsonResponse({ evidence_task: { ...baseTask, status: "succeeded" } }, options.completeStatus ?? 200);
    }

    if (url.pathname === "/api/v1/evidence-tasks/evtsk_test/fail" && method === "POST") {
      return jsonResponse({ evidence_task: { ...baseTask, status: "failed" } });
    }

    return jsonResponse({ error: "unexpected request" }, 500);
  }) as typeof fetch;
}

function fakeFetchForTasks(
  calls: Array<{ method: string; path: string; body: unknown }>,
  tasks: typeof baseTask[]
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === "/api/v1/evidence-workers/heartbeat" && method === "POST") {
      return jsonResponse({
        evidence_worker: {
          id: "evw_test",
          agent_id: "claude_test_worker",
          status: body.status,
          effective_status: body.status
        }
      });
    }

    if (url.pathname === "/api/v1/evidence-tasks" && method === "GET") {
      return jsonResponse({ evidence_tasks: tasks });
    }

    const claimMatch = url.pathname.match(/^\/api\/v1\/evidence-tasks\/([^/]+)\/claim$/);
    if (claimMatch && method === "POST") {
      const task = tasks.find((candidate) => candidate.id === claimMatch[1]);
      return task
        ? jsonResponse({ evidence_task: { ...task, status: "claimed", claimed_by_agent_id: "claude_test_worker" } })
        : jsonResponse({ error: "Evidence task not found" }, 404);
    }

    const completeMatch = url.pathname.match(/^\/api\/v1\/evidence-tasks\/([^/]+)\/complete$/);
    if (completeMatch && method === "POST") {
      const task = tasks.find((candidate) => candidate.id === completeMatch[1]);
      return task ? jsonResponse({ evidence_task: { ...task, status: "succeeded" } }) : jsonResponse({ error: "Evidence task not found" }, 404);
    }

    return jsonResponse({ error: "unexpected request" }, 500);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
