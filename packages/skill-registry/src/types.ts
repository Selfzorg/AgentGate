import type { SkillEvidenceTaskSpec } from "./evidence-task-specs";

export type SkillRegistrySourceType =
  | "codex_skill"
  | "claude_skill"
  | "claude_command"
  | "claude_subagent"
  | "mcp_tool"
  | "native_connector"
  | "demo_fixture";
export type SkillRegistryScope = "repo" | "user";
export type SkillRegistrySkillType = "evidence" | "execution";
export type SkillRegistrySideEffectLevel = "read_only" | "simulated" | "mutating";
export type SkillRegistryRiskLevel = "low" | "medium" | "high" | "critical";
export type SkillRegistryRuntime =
  | "codex_cli"
  | "codex_mcp"
  | "claude_cli"
  | "claude_code_mcp"
  | "mcp_tool"
  | "native_connector"
  | "local_deterministic";

export type SkillRegistryCandidate = {
  id: string;
  skillId: string;
  name: string;
  description: string | null;
  sourceType: SkillRegistrySourceType;
  scope: SkillRegistryScope;
  sourcePath: string;
  relativePath: string;
  contentHash: string;
  declaredTools: string[];
  skillType: SkillRegistrySkillType;
  sideEffectLevel: SkillRegistrySideEffectLevel;
  defaultRiskLevel: SkillRegistryRiskLevel;
  allowedRuntimes: SkillRegistryRuntime[];
  preferredRuntimes: SkillRegistryRuntime[];
  warnings: string[];
  evidenceTasks?: SkillEvidenceTaskSpec[];
  metadata: Record<string, unknown>;
};

export type SkillRegistryDuplicateGroup = {
  normalizedName: string;
  candidates: Array<{
    id: string;
    skillId: string;
    name: string;
    sourceType: SkillRegistrySourceType;
    scope: SkillRegistryScope;
    relativePath: string;
    contentHash: string;
  }>;
};

export type ScanAgentSkillsInput = {
  rootDir: string;
  includeUserScopes?: boolean | undefined;
  userCodexSkillsDir?: string | undefined;
  userClaudeSkillsDir?: string | undefined;
  userClaudeCommandsDir?: string | undefined;
  userClaudeAgentsDir?: string | undefined;
};

export type ScanAgentSkillsResult = {
  rootDir: string;
  scannedAt: string;
  candidates: SkillRegistryCandidate[];
  warnings: string[];
  duplicateGroups: SkillRegistryDuplicateGroup[];
  summary: {
    total: number;
    bySourceType: Record<string, number>;
    byRiskLevel: Record<string, number>;
    bySideEffectLevel: Record<string, number>;
    warningCount: number;
  };
};

export type ParsedMarkdown = {
  frontmatter: Record<string, unknown>;
  body: string;
};
