const DANGEROUS_PATTERNS = [
  /\bproduction\b/i,
  /\bprod\b/i,
  /--prod\b/i,
  /\bmigrate:prod\b/i,
  /\bdeploy\b.*\bprod/i,
  /\bvercel\s+deploy\s+--prod\b/i,
  /\bgh\s+pr\s+merge\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\bdestroy\b/i,
  /\brm\s+-[^\n]*r[^\n]*f\b/i,
  /\bsudo\b/i,
  /\bkubectl\b/i,
  /\bhelm\b/i,
  /\bterraform\s+(apply|destroy)\b/i,
  /\bpsql\b.*\b-c\b/i
];

const SAFE_COMMAND_PATTERNS = [
  /^pwd$/,
  /^ls(\s|$)/,
  /^find\s+[^|;&`$<>]+$/,
  /^cat\s+[^|;&`$<>]+$/,
  /^head\s+[^|;&`$<>]+$/,
  /^tail\s+[^|;&`$<>]+$/,
  /^sed\s+-n\s+[^|;&`$<>]+$/,
  /^grep\s+[^|;&`$<>]+$/,
  /^rg(\s|$)/,
  /^git\s+(status|diff|log|show|branch|rev-parse)(\s|$)/,
  /^node\s+--version$/,
  /^npm\s+--version$/,
  /^pnpm\s+--version$/,
  /^yarn\s+--version$/,
  /^npm\s+test(\s|$)/,
  /^npm\s+run\s+(test|lint|typecheck)(\s|$)/,
  /^pnpm\s+(test|lint|typecheck|verify)(\s|$)/,
  /^pnpm\s+run\s+(test|lint|typecheck)(\s|$)/,
  /^yarn\s+(test|lint|typecheck)(\s|$)/,
  /^vitest(\s|$)/,
  /^tsc(\s|$)/,
  /^eslint(\s|$)/
];

const CHAIN_SPLIT = /\s*(?:&&|\|\||;|\n)\s*/;

export function classifyActionSafety({ toolName, rawAction }) {
  const tool = String(toolName ?? "");
  const action = String(rawAction ?? "").trim();
  const normalizedAction = action.replace(/\s+/g, " ");

  const danger = DANGEROUS_PATTERNS.find((pattern) => pattern.test(normalizedAction));
  if (danger) {
    return {
      isDangerous: true,
      isClearlySafe: false,
      reason: `Matched dangerous command pattern ${danger.toString()}.`
    };
  }

  if (tool === "Edit" || tool === "Write") {
    return {
      isDangerous: false,
      isClearlySafe: false,
      reason: "File mutation tools are not considered clearly safe while AgentGate is unavailable."
    };
  }

  if (tool.startsWith("mcp__") || tool.startsWith("mcp.")) {
    return {
      isDangerous: false,
      isClearlySafe: false,
      reason: "MCP tool calls require AgentGate availability unless explicitly allowed by policy."
    };
  }

  const segments = normalizedAction.split(CHAIN_SPLIT).map((segment) => segment.trim()).filter(Boolean);
  const safe =
    isShellTool(tool) &&
    segments.length > 0 &&
    segments.every((segment) => SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(segment)));

  return {
    isDangerous: false,
    isClearlySafe: safe,
    reason: safe
      ? "Command is a clearly safe read/test command."
      : "Command is not clearly safe enough for fail-open mode."
  };
}

function isShellTool(tool) {
  return ["Bash", "Shell", "shell", "exec_command"].includes(tool);
}
