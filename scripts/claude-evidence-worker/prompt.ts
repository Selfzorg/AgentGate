import type { AgentEvidenceResult, EvidenceTask } from "./types";
import { redactValue } from "./redaction";
import { parseJsonLoose, recordFrom } from "./utils";

export function buildEvidencePrompt(task: EvidenceTask): string {
  return [
    "You are an AgentGate read-only evidence worker.",
    "",
    "Verify the policy gate check described below. You may inspect local repository state, logs, and read-only metadata only.",
    "If the evidence task includes input.evidence_task, follow its instructions, success_criteria, allowed_actions, and target_files exactly.",
    "If input.evidence_task includes evidence_skill_id, use input.evidence_skill as the attached reusable verifier skill and follow its execution_snapshot when present.",
    "If input.read_file_snapshots is present, treat it as already collected read-only file evidence and use it before attempting any shell command.",
    "allowed_actions read_only means read-only inspection only. allowed_actions read_file means you may read local files named in target_files, instructions, or success_criteria with read-only commands such as Get-Content, cat, rg, or ls.",
    "If target_files is empty, infer the file path only from instructions or success_criteria. For a simple file-content check, inspect only the named file and return immediately.",
    "If task instructions ask you to create, edit, delete, deploy, merge, or mutate anything, do not perform it; return status \"failed\" with a short reason.",
    "Prefer fast, bounded checks. For test evidence, inspect existing logs, package scripts, or recent local metadata; do not run the test suite from this worker.",
    "Do not deploy, merge, push, write files, mutate databases, call production systems, or execute the target action.",
    "If evidence is not clearly present, return status \"missing\". If evidence contradicts the requirement, return status \"failed\".",
    "",
    "Return JSON only with this exact shape:",
    "{\"status\":\"passed|failed|missing\",\"reason\":\"short reason\",\"evidence\":{}}",
    "",
    "Evidence task:",
    JSON.stringify(redactValue(task), null, 2)
  ].join("\n");
}

export function parseAgentOutput(output: string): AgentEvidenceResult {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("Evidence agent returned empty output.");

  const parsed = parseJsonLoose(trimmed);
  const candidates = [
    parsed,
    recordFrom(parsed).result,
    recordFrom(parsed).content,
    recordFrom(parsed).message,
    recordFrom(parsed).text
  ];

  for (const candidate of candidates) {
    const resolved = typeof candidate === "string" ? parseJsonLoose(candidate) : candidate;
    const normalized = tryNormalizeAgentResult(resolved);
    if (normalized) return normalized;
  }

  throw new Error("Evidence agent output did not match the required JSON schema.");
}

export function normalizeAgentResult(value: AgentEvidenceResult): AgentEvidenceResult {
  const normalized = tryNormalizeAgentResult(value);
  if (!normalized) throw new Error("Evidence agent result did not match the required JSON schema.");
  return normalized;
}

function tryNormalizeAgentResult(value: unknown): AgentEvidenceResult | null {
  const record = recordFrom(value);
  const status = record.status;
  const reason = record.reason;
  if (status !== "passed" && status !== "failed" && status !== "missing") return null;
  if (typeof reason !== "string" || reason.trim().length === 0) return null;

  return {
    status,
    reason,
    evidence: recordFrom(record.evidence)
  };
}
