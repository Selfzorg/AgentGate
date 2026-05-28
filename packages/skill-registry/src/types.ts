export type SkillRegistrySourceType = "codex_skill" | "claude_command" | "claude_subagent";
export type SkillRegistryScope = "repo" | "user";
export type SkillRegistrySkillType = "evidence" | "execution";
export type SkillRegistrySideEffectLevel = "read_only" | "simulated" | "mutating";
export type SkillRegistryRiskLevel = "low" | "medium" | "high" | "critical";
export type SkillRegistryRuntime =
  | "codex_cli"
  | "codex_mcp"
  | "claude_cli"
  | "claude_code_mcp"
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
  metadata: Record<string, unknown>;
};

export type ScanAgentSkillsInput = {
  rootDir: string;
  includeUserScopes?: boolean | undefined;
  userCodexSkillsDir?: string | undefined;
  userClaudeCommandsDir?: string | undefined;
  userClaudeAgentsDir?: string | undefined;
};

export type ScanAgentSkillsResult = {
  rootDir: string;
  scannedAt: string;
  candidates: SkillRegistryCandidate[];
  warnings: string[];
};

export type ParsedMarkdown = {
  frontmatter: Record<string, unknown>;
  body: string;
};
