import type { AgentEvidenceResult, EvidenceTask } from "./types";
import { redactValue } from "./redaction";
import { parseJsonLoose, recordFrom } from "./utils";

export function buildEvidencePrompt(task: EvidenceTask): string {
  return [
    "You are an AgentGate read-only evidence worker.",
    "",
    "Verify the policy gate check described below. You may inspect local repository state, logs, and read-only metadata only.",
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
