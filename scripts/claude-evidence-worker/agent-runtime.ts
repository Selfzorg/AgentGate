import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentEvidenceResult, ClaudeEvidenceWorkerConfig, EvidenceTask } from "./types";
import { commandSpecFor } from "./command";
import { buildEvidencePrompt, parseAgentOutput } from "./prompt";
import { redactString } from "./redaction";
import { recordFrom } from "./utils";

const MAX_READ_FILE_SNAPSHOTS = 5;
const MAX_READ_FILE_SNAPSHOT_BYTES = 64 * 1024;
const DEMO_PASSING_CHECKS = new Set(["ci_passed", "tests_passed", "rollback_plan_exists", "staging_deploy_successful"]);

export async function runAgentEvidence(task: EvidenceTask, config: ClaudeEvidenceWorkerConfig): Promise<AgentEvidenceResult> {
  if (config.driver === "demo") return runDemoEvidence(task);

  const preparedTask = await prepareEvidenceTaskForAgent(task, config);
  const prompt = buildEvidencePrompt(preparedTask);
  const command = commandSpecFor(config);
  const output = await runSubprocess(command.command, command.args, prompt, config);
  return parseAgentOutput(output);
}

export async function prepareEvidenceTaskForAgent(
  task: EvidenceTask,
  config: ClaudeEvidenceWorkerConfig
): Promise<EvidenceTask> {
  if (!taskAllowsReadFileSnapshot(task)) return task;

  const candidatePaths = candidateReadFilePaths(task).slice(0, MAX_READ_FILE_SNAPSHOTS);
  if (candidatePaths.length === 0) return task;

  const snapshots = [];
  for (const candidatePath of candidatePaths) {
    const safePath = resolveWorkspacePath(config.workspaceDir, candidatePath);
    if (!safePath) {
      snapshots.push({ path: candidatePath, status: "blocked", reason: "path is outside the workspace or is not a relative file path" });
      continue;
    }

    try {
      const content = await readFile(safePath, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      snapshots.push({
        path: candidatePath,
        status: "present",
        bytes,
        truncated: bytes > MAX_READ_FILE_SNAPSHOT_BYTES,
        content: bytes > MAX_READ_FILE_SNAPSHOT_BYTES ? content.slice(0, MAX_READ_FILE_SNAPSHOT_BYTES) : content
      });
    } catch (error) {
      snapshots.push({
        path: candidatePath,
        status: "missing_or_unreadable",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ...task,
    input: {
      ...task.input,
      read_file_snapshots: snapshots
    }
  };
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

export function localDeterministicFallbackForMissingResult(
  task: EvidenceTask,
  config: ClaudeEvidenceWorkerConfig,
  agentResult: AgentEvidenceResult
): AgentEvidenceResult | null {
  if (agentResult.status !== "missing") return null;
  if (!config.fallbackToLocalDeterministic || config.driver === "demo") return null;
  if (!taskAllowsLocalDeterministic(task) || !DEMO_PASSING_CHECKS.has(task.check_key)) return null;

  const fallback = runDemoEvidence(task);
  const failureSummary = redactString(agentResult.reason).slice(0, 300);
  return {
    ...fallback,
    reason: `${fallback.reason} Local deterministic fallback used after agent returned missing for a built-in demo check.`,
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
  const dryRunEvidence = dryRunDemoEvidence(task);
  if (dryRunEvidence) return dryRunEvidence;

  const passed = DEMO_PASSING_CHECKS.has(task.check_key);
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
    let outputDir: string | undefined;
    let outputPath: string | undefined;
    const spawnChild = async () => {
      const childArgs = [...args];
      if (config.driver === "codex") {
        outputDir = await mkdtemp(join(tmpdir(), "agentgate-codex-evidence-"));
        outputPath = join(outputDir, "last-message.txt");
        const promptIndex = childArgs.lastIndexOf("-");
        const insertAt = promptIndex >= 0 ? promptIndex : childArgs.length;
        childArgs.splice(insertAt, 0, "--output-last-message", outputPath);
      }
      return spawn(command, childArgs, agentSubprocessOptions(config, command));
    };

    let settled = false;
    let child: ReturnType<typeof spawn> | undefined;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child?.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${config.agentTimeoutMs}ms.`));
    }, config.agentTimeoutMs);
    timeout.unref?.();

    let stdout = "";
    let stderr = "";
    spawnChild()
      .then((spawned) => {
        child = spawned;
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
          void cleanupOutputDir(outputDir);
          reject(error);
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (code === 0) {
            readFinalAgentOutput(outputPath, stdout)
              .then(resolvePromise, reject)
              .finally(() => void cleanupOutputDir(outputDir));
            return;
          }
          void cleanupOutputDir(outputDir);
          reject(new Error(`${command} exited with code ${code}: ${redactString(stderr || stdout)}`));
        });
        child.stdin.end(prompt);
      })
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void cleanupOutputDir(outputDir);
        reject(error);
      });
  });
}

function taskAllowsReadFileSnapshot(task: EvidenceTask): boolean {
  const input = recordFrom(task.input);
  const evidenceTask = recordFrom(input.evidence_task);
  const allowedActions = [...arrayOfStrings(input.allowed_actions), ...arrayOfStrings(evidenceTask.allowed_actions)];
  return allowedActions.includes("read_file") || allowedActions.includes("read_only");
}

function candidateReadFilePaths(task: EvidenceTask): string[] {
  const input = recordFrom(task.input);
  const evidenceTask = recordFrom(input.evidence_task);
  const explicitPaths = [...arrayOfStrings(input.target_files), ...arrayOfStrings(evidenceTask.target_files)];
  const inferredPaths = inferFilePaths([
    input.instruction,
    evidenceTask.instructions,
    ...arrayOfStrings(input.success_criteria),
    ...arrayOfStrings(evidenceTask.success_criteria)
  ]);
  return uniqueStrings([...explicitPaths, ...inferredPaths]).filter(Boolean);
}

function inferFilePaths(values: unknown[]): string[] {
  const paths: string[] = [];
  const filePathPattern =
    /(?:^|[\s"'`(])((?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+)(?=$|[\s"'`),.;:])/g;
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(filePathPattern)) {
      const candidate = match[1]?.replace(/[.,;:]+$/g, "");
      if (candidate) paths.push(candidate);
    }
  }
  return paths;
}

function resolveWorkspacePath(workspaceDir: string, candidatePath: string): string | null {
  if (!candidatePath || isAbsolute(candidatePath) || candidatePath.includes("..")) return null;
  const workspacePath = resolve(workspaceDir);
  const resolvedPath = resolve(workspacePath, candidatePath);
  const relativePath = relative(workspacePath, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return resolvedPath;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function readFinalAgentOutput(outputPath: string | undefined, stdout: string): Promise<string> {
  if (!outputPath) return stdout;

  try {
    const lastMessage = await readFile(outputPath, "utf8");
    return lastMessage.trim().length > 0 ? lastMessage : stdout;
  } catch {
    return stdout;
  }
}

async function cleanupOutputDir(outputDir: string | undefined) {
  if (!outputDir) return;
  await rm(outputDir, { recursive: true, force: true });
}

export function agentSubprocessOptions(config: ClaudeEvidenceWorkerConfig, command = ""): SpawnOptionsWithoutStdio {
  return {
    cwd: config.workspaceDir,
    env: {
      ...process.env,
      AGENTGATE_CLAUDE_EVIDENCE_AUTOSTART: "false",
      AGENTGATE_EVIDENCE_WORKER_CHILD: "true"
    },
    shell: shouldUseShellForCommand(command),
    stdio: ["pipe", "pipe", "pipe"]
  };
}

function dryRunDemoEvidence(task: EvidenceTask): AgentEvidenceResult | null {
  if (task.check_key !== "dry_run_completed" && task.check_key !== "schema_diff_generated" && task.check_key !== "backup_exists") {
    return null;
  }

  const input = recordFrom(task.input);
  const dryRunResult = recordFrom(input.dry_run_result);
  const resultPayload = recordFrom(dryRunResult.result);
  const artifacts = [...recordArray(dryRunResult.artifacts), ...recordArray(input.dry_run_artifacts)];
  let passed = false;
  let reason = "";

  if (task.check_key === "dry_run_completed") {
    passed = dryRunResult.status === "completed";
    reason = passed ? "Dry-run result completed successfully." : "Dry-run result is missing or incomplete.";
  } else if (task.check_key === "schema_diff_generated") {
    passed = resultPayload.schema_diff_generated === true || artifacts.some((artifact) => artifactMatches(artifact, "schema_diff", "schema"));
    reason = passed ? "Schema diff artifact was verified from the dry-run result." : "Dry-run result does not include a schema diff artifact.";
  } else {
    passed = resultPayload.backup_exists === true || artifacts.some((artifact) => artifactMatches(artifact, "database_backup", "backup"));
    reason = passed ? "Backup artifact was verified from the dry-run result." : "Dry-run result does not include a backup artifact.";
  }

  return {
    status: passed ? "passed" : "missing",
    reason,
    evidence: {
      source: "claude_evidence_worker_demo",
      task_id: task.id,
      check_key: task.check_key,
      runtime: task.runtime,
      dry_run_result_id: typeof dryRunResult.id === "string" ? dryRunResult.id : null,
      inspected: ["evidence_task.input.dry_run_result", "evidence_task.input.dry_run_artifacts"]
    }
  };
}

function artifactMatches(artifact: Record<string, unknown>, expectedType: string, textNeedle: string) {
  const type = typeof artifact.type === "string" ? artifact.type.toLowerCase() : "";
  const artifactId = typeof artifact.artifact_id === "string" ? artifact.artifact_id.toLowerCase() : "";
  return type === expectedType || type.includes(textNeedle) || artifactId.includes(textNeedle);
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];
}

function shouldUseShellForCommand(command: string): boolean {
  if (process.platform !== "win32") return false;
  return !command || !isAbsolute(command);
}
