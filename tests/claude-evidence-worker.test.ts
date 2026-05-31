import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ClaudeEvidenceWorkerConfig,
  agentSubprocessOptions,
  buildEvidencePrompt,
  commandSpecFor,
  configFromEnv,
  parseAgentOutput,
  prepareEvidenceTaskForAgent,
  resolveCodexCommand,
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

  it("falls back to local deterministic evidence when a built-in demo check returns missing", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const task = {
      ...baseTask,
      id: "evtsk_rollback",
      check_key: "rollback_plan_exists",
      label: "Rollback plan exists",
      input: {
        ...baseTask.input,
        evidence_skill: {
          skill_id: "verify-rollback-plan",
          allowed_runtimes: ["codex_cli", "local_deterministic"],
          side_effect_level: "read_only"
        }
      }
    };

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "codex", runtime: "codex_cli", fallbackToLocalDeterministic: true },
      {
        fetchImpl: fakeFetchForTasks(calls, [task]),
        writeLog: async () => {},
        runAgentEvidence: async () => ({
          status: "missing",
          reason: "read-only shell access failed before repository evidence could be collected.",
          evidence: {}
        })
      }
    );

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    const completeBody = calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_rollback/complete")?.body;
    expect(completeBody).toMatchObject({
      agent_id: "claude_test_worker",
      status: "passed",
      reason: expect.stringContaining("Rollback plan exists verified by demo Claude evidence worker."),
      evidence: {
        source: "local_deterministic_fallback",
        fallback_from_runtime: "codex_cli",
        fallback_from_driver: "codex",
        fallback_reason: "read-only shell access failed before repository evidence could be collected."
      }
    });
  });

  it("falls back from agent missing for every built-in demo check", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const builtInChecks = [
      ["ci_passed", "CI passed", "verify-ci-status"],
      ["tests_passed", "Tests passed", "verify-tests-passed"],
      ["rollback_plan_exists", "Rollback plan exists", "verify-rollback-plan"],
      ["staging_deploy_successful", "Staging deploy successful", "verify-staging-deploy"]
    ] as const;
    const tasks = builtInChecks.map(([checkKey, label, skillId], index) => ({
      ...baseTask,
      id: `evtsk_builtin_${index}`,
      check_key: checkKey,
      label,
      input: {
        ...baseTask.input,
        evidence_skill: {
          skill_id: skillId,
          allowed_runtimes: ["codex_cli", "local_deterministic"],
          side_effect_level: "read_only"
        }
      }
    }));

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "codex", runtime: "codex_cli", fallbackToLocalDeterministic: true, limit: 4, maxTasksPerTick: 4 },
      {
        fetchImpl: fakeFetchForTasks(calls, tasks),
        writeLog: async () => {},
        runAgentEvidence: async () => ({
          status: "missing",
          reason: "windows sandbox: spawn setup refresh",
          evidence: {}
        })
      }
    );

    expect(result).toEqual({ scanned: 4, claimed: 4, completed: 4, failed: 0, skipped: 0 });
    const completeBodies = calls
      .filter((call) => call.path.endsWith("/complete"))
      .map((call) => call.body as Record<string, unknown>);
    expect(completeBodies).toHaveLength(4);
    for (const body of completeBodies) {
      expect(body).toMatchObject({
        status: "passed",
        reason: expect.stringContaining("Local deterministic fallback used after agent returned missing for a built-in demo check."),
        evidence: {
          source: "local_deterministic_fallback",
          fallback_from_driver: "codex",
          fallback_from_runtime: "codex_cli",
          fallback_reason: "windows sandbox: spawn setup refresh"
        }
      });
    }
  });

  it("does not use deterministic fallback for a missing built-in check when fallback is disabled", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "codex", runtime: "codex_cli", fallbackToLocalDeterministic: false },
      {
        fetchImpl: fakeFetch(calls),
        writeLog: async () => {},
        runAgentEvidence: async () => ({
          status: "missing",
          reason: "read-only shell access failed.",
          evidence: {}
        })
      }
    );

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    const completeBody = calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_test/complete")?.body;
    expect(completeBody).toMatchObject({
      status: "missing",
      reason: "read-only shell access failed."
    });
  });

  it("does not use deterministic fallback when the evidence skill disallows it", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const task = {
      ...baseTask,
      input: {
        ...baseTask.input,
        evidence_skill: {
          skill_id: "verify-ci-status",
          allowed_runtimes: ["codex_cli"],
          side_effect_level: "read_only"
        }
      }
    };

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "codex", runtime: "codex_cli", fallbackToLocalDeterministic: true },
      {
        fetchImpl: fakeFetchForTasks(calls, [task]),
        writeLog: async () => {},
        runAgentEvidence: async () => ({
          status: "missing",
          reason: "agent could not inspect shell output.",
          evidence: {}
        })
      }
    );

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    const completeBody = calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_test/complete")?.body;
    expect(completeBody).toMatchObject({
      status: "missing",
      reason: "agent could not inspect shell output."
    });
  });

  it("verifies dry-run checks from persisted dry-run result artifacts", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const dryRunArtifacts = [
      { type: "schema_diff", artifact_id: "artifact_schema_diff_001" },
      { type: "database_backup", artifact_id: "artifact_backup_001" }
    ];
    const dryRunResult = {
      id: "dryrun_test",
      status: "completed",
      summary: "Dry-run completed for test migration.",
      result: {
        schema_diff_generated: true,
        backup_exists: true
      },
      artifacts: dryRunArtifacts
    };
    const tasks = [
      { ...baseTask, id: "evtsk_dry_complete", check_key: "dry_run_completed", label: "Dry-run completed" },
      { ...baseTask, id: "evtsk_dry_schema", check_key: "schema_diff_generated", label: "Schema diff generated" },
      { ...baseTask, id: "evtsk_dry_backup", check_key: "backup_exists", label: "Backup exists" }
    ].map((task) => ({
      ...task,
      runtime: "local_deterministic",
      input: {
        ...task.input,
        dry_run_result: dryRunResult,
        dry_run_artifacts: dryRunArtifacts
      }
    }));

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "demo", runtime: "local_deterministic", limit: 3, maxTasksPerTick: 3 },
      {
        fetchImpl: fakeFetchForTasks(calls, tasks),
        writeLog: async () => {}
      }
    );

    expect(result).toEqual({ scanned: 3, claimed: 3, completed: 3, failed: 0, skipped: 0 });
    const completeBodies = calls
      .filter((call) => call.path.endsWith("/complete"))
      .map((call) => call.body as Record<string, unknown>);
    expect(completeBodies).toHaveLength(3);
    expect(completeBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "passed",
          reason: "Dry-run result completed successfully.",
          evidence: expect.objectContaining({ check_key: "dry_run_completed", dry_run_result_id: "dryrun_test" })
        }),
        expect.objectContaining({
          status: "passed",
          reason: "Schema diff artifact was verified from the dry-run result.",
          evidence: expect.objectContaining({ check_key: "schema_diff_generated", dry_run_result_id: "dryrun_test" })
        }),
        expect.objectContaining({
          status: "passed",
          reason: "Backup artifact was verified from the dry-run result.",
          evidence: expect.objectContaining({ check_key: "backup_exists", dry_run_result_id: "dryrun_test" })
        })
      ])
    );
  });

  it("does not pass dry-run artifact checks when the dry-run result is incomplete", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const task = {
      ...baseTask,
      id: "evtsk_dry_missing_backup",
      check_key: "backup_exists",
      label: "Backup exists",
      runtime: "local_deterministic",
      input: {
        ...baseTask.input,
        dry_run_result: {
          id: "dryrun_missing_backup",
          status: "completed",
          result: {},
          artifacts: [{ type: "schema_diff", artifact_id: "artifact_schema_diff_001" }]
        },
        dry_run_artifacts: [{ type: "schema_diff", artifact_id: "artifact_schema_diff_001" }]
      }
    };

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "demo", runtime: "local_deterministic" },
      {
        fetchImpl: fakeFetchForTasks(calls, [task]),
        writeLog: async () => {}
      }
    );

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    const completeBody = calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_dry_missing_backup/complete")?.body;
    expect(completeBody).toMatchObject({
      status: "missing",
      reason: "Dry-run result does not include a backup artifact.",
      evidence: {
        check_key: "backup_exists",
        dry_run_result_id: "dryrun_missing_backup"
      }
    });
  });

  it("fails instead of falling back after a technical agent failure when fallback runtime is disallowed", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const task = {
      ...baseTask,
      input: {
        ...baseTask.input,
        evidence_skill: {
          skill_id: "verify-ci-status",
          allowed_runtimes: ["codex_cli"],
          side_effect_level: "read_only"
        }
      }
    };

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "codex", runtime: "codex_cli", fallbackToLocalDeterministic: true },
      {
        fetchImpl: fakeFetchForTasks(calls, [task]),
        writeLog: async () => {},
        runAgentEvidence: async () => {
          throw new Error("codex exited with code 1");
        }
      }
    );

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 0, failed: 1, skipped: 0 });
    expect(calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_test/fail")?.body).toMatchObject({
      reason: "codex exited with code 1"
    });
  });

  it("does not pass custom evidence through deterministic fallback when the agent returns missing", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const task = {
      ...baseTask,
      id: "evtsk_custom",
      check_key: "custom_evidence_1",
      label: "Custom evidence 1",
      input: {
        ...baseTask.input,
        evidence_task: {
          check_key: "custom_evidence_1",
          label: "Custom evidence 1",
          instructions: "Read verified.md and confirm it contains expected text.",
          allowed_actions: ["read_file"],
          target_files: ["verified.md"]
        },
        evidence_skill: {
          skill_id: "verify-custom_evidence_1",
          allowed_runtimes: ["codex_cli", "local_deterministic"],
          side_effect_level: "read_only"
        }
      }
    };

    const result = await runWorkerOnce(
      { ...testConfig(), driver: "codex", runtime: "codex_cli", fallbackToLocalDeterministic: true },
      {
        fetchImpl: fakeFetchForTasks(calls, [task]),
        writeLog: async () => {},
        runAgentEvidence: async () => ({
          status: "missing",
          reason: "verified.md did not contain expected evidence.",
          evidence: {}
        })
      }
    );

    expect(result).toEqual({ scanned: 1, claimed: 1, completed: 1, failed: 0, skipped: 0 });
    const completeBody = calls.find((call) => call.path === "/api/v1/evidence-tasks/evtsk_custom/complete")?.body;
    expect(completeBody).toMatchObject({
      agent_id: "claude_test_worker",
      status: "missing",
      reason: "verified.md did not contain expected evidence."
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

    const noisyCodexOutput = [
      'exec "Get-Content verified.md"',
      '{"check_key":"custom_evidence_1"}',
      'tokens used',
      '{"status":"passed","reason":"verified.md contains the expected text.","evidence":{"file":"verified.md"}}'
    ].join("\n");
    expect(parseAgentOutput(noisyCodexOutput)).toEqual({
      status: "passed",
      reason: "verified.md contains the expected text.",
      evidence: { file: "verified.md" }
    });
  });

  it("builds a read-only prompt with forbidden side effects", () => {
    const prompt = buildEvidencePrompt({
      ...baseTask,
      input: {
        ...baseTask.input,
        evidence_task: {
          check_key: "customer_file_not_empty",
          label: "Customer file is present",
          evidence_skill_id: "verify-customer-file",
          instructions: "Read customer.md and confirm it exists and is not empty.",
          success_criteria: ["customer.md exists"],
          allowed_actions: ["read_file"],
          target_files: ["customer.md"]
        }
      }
    });
    expect(prompt).toContain("read-only evidence worker");
    expect(prompt).toContain("follow its instructions, success_criteria, allowed_actions, and target_files exactly");
    expect(prompt).toContain("use input.evidence_skill as the attached reusable verifier skill");
    expect(prompt).toContain("input.read_file_snapshots");
    expect(prompt).toContain("allowed_actions read_only means read-only inspection only");
    expect(prompt).toContain("allowed_actions read_file means you may read local files");
    expect(prompt).toContain("If target_files is empty, infer the file path only from instructions or success_criteria");
    expect(prompt).toContain("Do not deploy");
    expect(prompt).toContain("\"check_key\": \"ci_passed\"");
    expect(prompt).toContain("Read customer.md and confirm it exists and is not empty.");
    expect(prompt).toContain("\"target_files\": [");
  });

  it("adds read-only file snapshots for read_file evidence tasks", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "agentgate-evidence-test-"));
    try {
      await writeFile(join(workspaceDir, "verified.md"), "Run Tests successfully\n", "utf8");
      const prepared = await prepareEvidenceTaskForAgent(
        {
          ...baseTask,
          input: {
            instruction: 'Read verified.md and confirm it contains "Run Tests successfully".',
            evidence_task: {
              check_key: "custom_evidence_1",
              label: "Custom evidence 1",
              instructions: 'Read verified.md and confirm it contains "Run Tests successfully".',
              allowed_actions: ["read_file"],
              target_files: []
            }
          }
        },
        { ...testConfig(), workspaceDir }
      );

      expect(prepared.input.read_file_snapshots).toEqual([
        expect.objectContaining({
          path: "verified.md",
          status: "present",
          content: expect.stringContaining("Run Tests successfully")
        })
      ]);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("captures present, missing, blocked, and truncated read-only file snapshots", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "agentgate-evidence-test-"));
    try {
      await mkdir(join(workspaceDir, "evidence"), { recursive: true });
      await writeFile(join(workspaceDir, "evidence", "ok.txt"), "ok\n", "utf8");
      await writeFile(join(workspaceDir, "large.log"), "x".repeat(70 * 1024), "utf8");
      const prepared = await prepareEvidenceTaskForAgent(
        {
          ...baseTask,
          input: {
            instruction: "Read evidence/ok.txt and missing.md.",
            target_files: ["evidence/ok.txt", "missing.md", "../outside.txt", "large.log"],
            evidence_task: {
              check_key: "file_bundle",
              label: "File bundle",
              instructions: "Read evidence/ok.txt and missing.md.",
              allowed_actions: ["read_file"],
              target_files: []
            }
          }
        },
        { ...testConfig(), workspaceDir }
      );

      expect(prepared.input.read_file_snapshots).toEqual([
        expect.objectContaining({ path: "evidence/ok.txt", status: "present", content: "ok\n" }),
        expect.objectContaining({ path: "missing.md", status: "missing_or_unreadable" }),
        expect.objectContaining({ path: "../outside.txt", status: "blocked" }),
        expect.objectContaining({ path: "large.log", status: "present", truncated: true })
      ]);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("does not add file snapshots for plural read_files without read_file permission", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "agentgate-evidence-test-"));
    try {
      await writeFile(join(workspaceDir, "verified.md"), "Run Tests successfully\n", "utf8");
      const prepared = await prepareEvidenceTaskForAgent(
        {
          ...baseTask,
          input: {
            instruction: "Read verified.md.",
            target_files: ["verified.md"],
            allowed_actions: ["read_files"]
          }
        },
        { ...testConfig(), workspaceDir }
      );

      expect(prepared.input.read_file_snapshots).toBeUndefined();
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
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

  it("runs Codex evidence jobs with current read-only exec flags", () => {
    const config = {
      ...testConfig(),
      driver: "codex" as const,
      runtime: "codex_cli",
      codexCommand: "/opt/codex/bin/codex",
      workspaceDir: "/tmp/agentgate"
    };
    const command = commandSpecFor(config);

    expect(command.command).toBe("/opt/codex/bin/codex");
    expect(command.args).toEqual(
      expect.arrayContaining([
        "exec",
        "-c",
        'approval_policy="never"',
        "--cd",
        "/tmp/agentgate",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "-"
      ])
    );
    expect(command.args).not.toContain("--ask-for-approval");
    expect(command.args).not.toContain("--ephemeral");
  });

  it("passes Codex model flag as an exec option when configured", () => {
    const command = commandSpecFor({
      ...testConfig(),
      driver: "codex",
      runtime: "codex_cli",
      model: "gpt-5"
    });

    expect(command.args.slice(0, 3)).toEqual(["exec", "--model", "gpt-5"]);
  });

  it("does not force a default Codex model", () => {
    const config = configFromEnv(
      {
        AGENTGATE_EVIDENCE_AGENT_DRIVER: "codex",
        AGENTGATE_EVIDENCE_CODEX_CLI_PATH: "/opt/codex/bin/codex"
      },
      process.cwd()
    );

    expect(config.codexCommand).toBe("/opt/codex/bin/codex");
    expect(config.model).toBeUndefined();
  });

  it("resolves Codex command from explicit environment before config or PATH", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "agentgate-codex-config-"));
    try {
      const explicitCodex = join(workspaceDir, "explicit-codex");
      const configuredCodex = join(workspaceDir, "configured-codex");
      await writeFile(explicitCodex, "", "utf8");
      await writeFile(configuredCodex, "", "utf8");
      await writeFile(join(workspaceDir, "config.toml"), `CODEX_CLI_PATH = '${configuredCodex}'\n`, "utf8");

      expect(
        resolveCodexCommand({
          AGENTGATE_EVIDENCE_CODEX_CLI_PATH: explicitCodex,
          CODEX_HOME: workspaceDir
        })
      ).toBe(explicitCodex);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("resolves Codex command from CODEX_CLI_PATH in Codex config", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "agentgate-codex-config-"));
    try {
      const configuredCodex = join(workspaceDir, "configured-codex");
      await writeFile(configuredCodex, "", "utf8");
      await writeFile(join(workspaceDir, "config.toml"), `CODEX_CLI_PATH = '${configuredCodex}'\n`, "utf8");

      expect(resolveCodexCommand({ CODEX_HOME: workspaceDir })).toBe(configuredCodex);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("lets explicit evidence model configuration override the Codex default", () => {
    const config = configFromEnv(
      {
        ...process.env,
        AGENTGATE_EVIDENCE_AGENT_DRIVER: "codex",
        AGENTGATE_EVIDENCE_AGENT_MODEL: "gpt-5-mini"
      },
      process.cwd()
    );

    expect(config.model).toBe("gpt-5-mini");
  });

  it("uses shell command resolution for agent CLIs on Windows", () => {
    const config = testConfig();
    const options = agentSubprocessOptions(config, "codex");

    expect(options.cwd).toBe(config.workspaceDir);
    expect(options.shell).toBe(process.platform === "win32");
    expect(options.env).toMatchObject({
      AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART: "false",
      AGENTGATE_EVIDENCE_WORKER_CHILD: "true"
    });
  });

  it("spawns absolute Codex executables directly on Windows", () => {
    const config = testConfig();
    const command = process.platform === "win32" ? "C:\\Users\\demo\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe" : "/opt/codex/bin/codex";
    const options = agentSubprocessOptions(config, command);

    expect(options.shell).toBe(false);
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

    const failMatch = url.pathname.match(/^\/api\/v1\/evidence-tasks\/([^/]+)\/fail$/);
    if (failMatch && method === "POST") {
      const task = tasks.find((candidate) => candidate.id === failMatch[1]);
      return task ? jsonResponse({ evidence_task: { ...task, status: "failed" } }) : jsonResponse({ error: "Evidence task not found" }, 404);
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
