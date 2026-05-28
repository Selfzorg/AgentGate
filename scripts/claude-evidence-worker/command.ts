import type { ClaudeEvidenceWorkerConfig } from "./types";
import { splitCommand } from "./utils";

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { enum: ["passed", "failed", "missing"] },
    reason: { type: "string", minLength: 1 },
    evidence: {
      type: "object",
      additionalProperties: true
    }
  },
  required: ["status", "reason", "evidence"]
};

export function commandSpecFor(config: ClaudeEvidenceWorkerConfig) {
  if (config.agentCommand) {
    const [command, ...args] = splitCommand(config.agentCommand);
    if (!command) throw new Error("AGENTGATE_EVIDENCE_AGENT_COMMAND is empty.");
    return { command, args };
  }

  if (config.driver === "codex") {
    const args = [
      "exec",
      "--cd",
      config.workspaceDir,
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "--ephemeral",
      "--color",
      "never",
      "-"
    ];
    if (config.model) args.splice(1, 0, "--model", config.model);
    return { command: "codex", args };
  }

  const args = [
    "--bare",
    "--print",
    "--input-format",
    "text",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--add-dir",
    config.workspaceDir,
    "--allowedTools",
    config.allowedTools,
    "--disallowedTools",
    config.disallowedTools,
    "--json-schema",
    JSON.stringify(RESULT_SCHEMA)
  ];
  if (config.model) args.splice(0, 0, "--model", config.model);
  return { command: "claude", args };
}
