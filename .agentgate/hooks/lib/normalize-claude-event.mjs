import { isAgentGateMcpTool, normalizeMcpToolName, normalizeToolEvent } from "./normalize-tool-event.mjs";

const SUPPORTED_TOOLS = new Set(["Bash", "Edit", "Write"]);
const SHELL_TOOLS = new Set(["Bash"]);
const EDIT_TOOLS = new Set(["Edit"]);
const WRITE_TOOLS = new Set(["Write"]);

export function normalizeClaudeEvent(event, env = process.env) {
  return normalizeToolEvent(event, env, {
    source: "claude-code",
    supportedTools: SUPPORTED_TOOLS,
    shellTools: SHELL_TOOLS,
    editTools: EDIT_TOOLS,
    writeTools: WRITE_TOOLS
  });
}

export { isAgentGateMcpTool, normalizeMcpToolName };
