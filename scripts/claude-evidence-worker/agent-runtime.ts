import { spawn } from "node:child_process";
import type { AgentEvidenceResult, ClaudeEvidenceWorkerConfig, EvidenceTask } from "./types";
import { commandSpecFor } from "./command";
import { buildEvidencePrompt, parseAgentOutput } from "./prompt";
import { redactString } from "./redaction";
import { recordFrom } from "./utils";

export async function runAgentEvidence(task: EvidenceTask, config: ClaudeEvidenceWorkerConfig): Promise<AgentEvidenceResult> {
  if (config.driver === "demo") return runDemoEvidence(task);

  const prompt = buildEvidencePrompt(task);
  const command = commandSpecFor(config);
  const output = await runSubprocess(command.command, command.args, prompt, config);
  return parseAgentOutput(output);
}

export function localDeterministicFallbackResult(
  task: EvidenceTask,
  config: ClaudeEvidenceWorkerConfig,
  agentFailureReason: string
): AgentEvidenceResult | null {
  if (!config.fallbackToLocalDeterministic || config.driver === "demo") return null;
  if (!taskAllowsLocalDeterministic(task)) return null;

  const fallback = runDemoEvidence(task);
  const failureSummary = redactString(agentFailureReason).slice(0, 300);
  return {
    ...fallback,
    reason: `${fallback.reason} Local deterministic fallback used after agent runtime error.`,
    evidence: {
      ...fallback.evidence,
      source: "local_deterministic_fallback",
      fallback_from_runtime: config.runtime,
      fallback_from_driver: config.driver,
      fallback_reason: failureSummary
    }
  };
}

function runDemoEvidence(task: EvidenceTask): AgentEvidenceResult {
  const passingChecks = new Set(["ci_passed", "tests_passed", "rollback_plan_exists", "staging_deploy_successful"]);
  const passed = passingChecks.has(task.check_key);
  return {
    status: passed ? "passed" : "missing",
    reason: passed
      ? `${task.label} verified by demo Claude evidence worker.`
      : `${task.label} evidence is missing in demo Claude evidence worker.`,
    evidence: {
      source: "claude_evidence_worker_demo",
      task_id: task.id,
      check_key: task.check_key,
      runtime: task.runtime,
      inspected: ["evidence_task.input"]
    }
  };
}

function taskAllowsLocalDeterministic(task: EvidenceTask): boolean {
  const evidenceSkill = recordFrom(recordFrom(task.input).evidence_skill);
  const allowed = evidenceSkill.allowed_runtimes;
  if (!Array.isArray(allowed)) return true;
  return allowed.includes("local_deterministic") || allowed.includes("deterministic") || allowed.includes("agent");
}

function runSubprocess(command: string, args: string[], prompt: string, config: ClaudeEvidenceWorkerConfig): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: config.workspaceDir,
      env: {
        ...process.env,
        AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART: "false",
        AGENTGATE_EVIDENCE_WORKER_CHILD: "true"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${config.agentTimeoutMs}ms.`));
    }, config.agentTimeoutMs);
    timeout.unref?.();

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${redactString(stderr || stdout)}`));
    });
    child.stdin.end(prompt);
  });
}
