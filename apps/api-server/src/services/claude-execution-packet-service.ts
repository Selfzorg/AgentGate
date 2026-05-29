import type { ExecutionToken } from "@prisma/client";

export type ClaudeExecutionPacketRun = {
  id: string;
  traceId: string;
  rawAction: string;
  context: unknown;
  environment: string | null;
  approvalRequest?: { id: string; status: string } | null;
  skill?: { name: string; description: string | null } | null;
};

export type ClaudeExecutionPacketSnapshot = {
  entrypointPath: string;
  sourcePath: string | null;
  entrypointContent: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sourceHash: string;
  entrypointContentHash: string;
  supportingFiles: Array<{ path: string; content_hash: string; size_bytes: number; content: string }>;
  warnings: string[];
};

export function buildClaudeExecutionPacket(input: {
  run: ClaudeExecutionPacketRun;
  skillId: string;
  sourceType: string;
  approvedHash: string | null;
  approvedVersion: string | null;
  approvedVersionId: string;
  token: ExecutionToken;
  snapshot: ClaudeExecutionPacketSnapshot;
}) {
  return {
    version: "agentgate.claude_execution_packet.v1",
    run_id: input.run.id,
    trace_id: input.run.traceId,
    status: "approved_for_local_claude_execution",
    instructions: [
      "You are Claude Code continuing an AgentGate-approved run.",
      "Execute only the approved skill body below for the approved raw_action and context.",
      "Do not substitute a different skill, path, target, environment, or high-risk action.",
      "Every tool call you make must still pass through the installed AgentGate hook/MCP controls.",
      "If the approved body is insufficient or asks for a materially different action, stop and ask for re-approval."
    ],
    approved_action: {
      raw_action: input.run.rawAction,
      environment: input.run.environment,
      context: input.run.context
    },
    skill: {
      skill_id: input.skillId,
      name: input.run.skill?.name ?? input.skillId,
      description: input.run.skill?.description ?? null,
      source_type: input.sourceType,
      version: input.approvedVersion,
      skill_version_id: input.approvedVersionId,
      approved_hash: input.approvedHash,
      entrypoint_path: input.snapshot.entrypointPath,
      source_path: input.snapshot.sourcePath,
      source_hash: input.snapshot.sourceHash,
      entrypoint_content_hash: input.snapshot.entrypointContentHash,
      frontmatter: input.snapshot.frontmatter,
      body: input.snapshot.body,
      entrypoint_content: input.snapshot.entrypointContent,
      supporting_files: input.snapshot.supportingFiles,
      warnings: input.snapshot.warnings
    },
    safety: {
      approval_status: input.run.approvalRequest?.status ?? "not_required",
      execution_token_id: input.token.id,
      token_status: "used",
      token_scope: Array.isArray(input.token.scopes) ? input.token.scopes.filter((scope): scope is string => typeof scope === "string") : [],
      token_expires_at: input.token.expiresAt.toISOString(),
      skill_hash_verified: true,
      backend_runner_simulation_used: false
    }
  };
}
