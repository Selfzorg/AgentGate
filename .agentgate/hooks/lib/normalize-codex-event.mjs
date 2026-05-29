import { isAgentGateMcpTool, normalizeMcpToolName, normalizeToolEvent } from "./normalize-tool-event.mjs";

const SUPPORTED_TOOLS = new Set(["Bash", "Shell", "shell", "exec_command", "apply_patch", "ApplyPatch", "Edit", "Write"]);
const SHELL_TOOLS = new Set(["Bash", "Shell", "shell", "exec_command"]);
const EDIT_TOOLS = new Set(["Edit"]);
const WRITE_TOOLS = new Set(["Write"]);
const PATCH_TOOLS = new Set(["apply_patch", "ApplyPatch"]);

export function normalizeCodexEvent(event, env = process.env) {
  return normalizeToolEvent(event, env, {
    source: "codex",
    supportedTools: SUPPORTED_TOOLS,
    shellTools: SHELL_TOOLS,
    editTools: EDIT_TOOLS,
    writeTools: WRITE_TOOLS,
    patchTools: PATCH_TOOLS
  });
}

export { isAgentGateMcpTool, normalizeMcpToolName };
