import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { classifySkillCandidate } from "./classifier";
import { parseMarkdownFrontmatter, stringFrom, stringListFrom } from "./frontmatter";
import type {
  ScanAgentSkillsInput,
  ScanAgentSkillsResult,
  SkillRegistryCandidate,
  SkillRegistryRuntime,
  SkillRegistryScope,
  SkillRegistrySourceType
} from "./types";

const ignoredDirectories = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

type DiscoveryTarget = {
  rootDir: string;
  pattern: "codex_skill" | "markdown";
  sourceType: SkillRegistrySourceType;
  scope: SkillRegistryScope;
};

export async function scanAgentSkills(input: ScanAgentSkillsInput): Promise<ScanAgentSkillsResult> {
  const rootDir = resolve(input.rootDir);
  const warnings: string[] = [];
  const targets = discoveryTargets(rootDir, input);
  const candidateGroups = await Promise.all(targets.map((target) => scanTarget(target, rootDir)));
  const candidates = candidateGroups.flat().sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    rootDir,
    scannedAt: new Date().toISOString(),
    candidates,
    warnings
  };
}

function discoveryTargets(rootDir: string, input: ScanAgentSkillsInput): DiscoveryTarget[] {
  const targets: DiscoveryTarget[] = [
    {
      rootDir: join(rootDir, ".agents", "skills"),
      pattern: "codex_skill",
      sourceType: "codex_skill",
      scope: "repo"
    },
    {
      rootDir: join(rootDir, ".claude", "commands"),
      pattern: "markdown",
      sourceType: "claude_command",
      scope: "repo"
    },
    {
      rootDir: join(rootDir, ".claude", "agents"),
      pattern: "markdown",
      sourceType: "claude_subagent",
      scope: "repo"
    }
  ];

  if (input.includeUserScopes) {
    targets.push(
      {
        rootDir: input.userCodexSkillsDir ?? join(homedir(), ".codex", "skills"),
        pattern: "codex_skill",
        sourceType: "codex_skill",
        scope: "user"
      },
      {
        rootDir: input.userClaudeCommandsDir ?? join(homedir(), ".claude", "commands"),
        pattern: "markdown",
        sourceType: "claude_command",
        scope: "user"
      },
      {
        rootDir: input.userClaudeAgentsDir ?? join(homedir(), ".claude", "agents"),
        pattern: "markdown",
        sourceType: "claude_subagent",
        scope: "user"
      }
    );
  }

  return targets;
}

async function scanTarget(target: DiscoveryTarget, workspaceRoot: string) {
  const exists = await directoryExists(target.rootDir);
  if (!exists) return [];

  const files = await collectFiles(target.rootDir);
  const matchingFiles = files.filter((file) => {
    if (target.pattern === "codex_skill") return basename(file) === "SKILL.md";
    return file.endsWith(".md");
  });

  return Promise.all(
    matchingFiles.map((file) =>
      candidateFromFile({
        file,
        target,
        workspaceRoot
      })
    )
  );
}

async function candidateFromFile(input: {
  file: string;
  target: DiscoveryTarget;
  workspaceRoot: string;
}): Promise<SkillRegistryCandidate> {
  const content = await readFile(input.file, "utf8");
  const parsed = parseMarkdownFrontmatter(content);
  const declaredTools = declaredToolsFrom(parsed.frontmatter);
  const sourceRelativePath = relative(input.workspaceRoot, input.file);
  const sourceName = sourceNameFor(input.file, input.target.sourceType);
  const name = stringFrom(parsed.frontmatter.name, parsed.frontmatter.title, sourceName) ?? sourceName;
  const description = stringFrom(parsed.frontmatter.description, firstParagraph(parsed.body));
  const classification = classifySkillCandidate({
    sourceType: input.target.sourceType,
    name,
    description,
    body: parsed.body,
    declaredTools
  });
  const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  const runtimePlan = runtimesFor(input.target.sourceType, classification.skillType);
  const warnings = [...classification.warnings];

  if (parsed.frontmatter.parse_error) warnings.push(String(parsed.frontmatter.parse_error));

  return {
    id: candidateId(input.target.sourceType, input.target.scope, sourceRelativePath, contentHash),
    skillId: skillIdFor(input.target.sourceType, input.target.scope, sourceRelativePath),
    name,
    description,
    sourceType: input.target.sourceType,
    scope: input.target.scope,
    sourcePath: input.file,
    relativePath: sourceRelativePath,
    contentHash,
    declaredTools,
    skillType: classification.skillType,
    sideEffectLevel: classification.sideEffectLevel,
    defaultRiskLevel: classification.defaultRiskLevel,
    allowedRuntimes: runtimePlan.allowed,
    preferredRuntimes: runtimePlan.preferred,
    warnings,
    metadata: {
      frontmatter: parsed.frontmatter,
      source_directory: dirname(input.file)
    }
  };
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);
    return result.isDirectory();
  } catch {
    return false;
  }
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.flatMap((entry) => {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
      const fullPath = join(rootDir, entry.name);
      return entry.isDirectory() ? [collectFiles(fullPath)] : [Promise.resolve([fullPath])];
    })
  );
  return nested.flat();
}

function declaredToolsFrom(frontmatter: Record<string, unknown>): string[] {
  return [
    ...new Set([
      ...stringListFrom(frontmatter["allowed-tools"]),
      ...stringListFrom(frontmatter.allowed_tools),
      ...stringListFrom(frontmatter.tools)
    ])
  ];
}

function firstParagraph(body: string): string | null {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((entry) => entry.replace(/^#+\s*/, "").trim())
    .find((entry) => entry.length > 0);
  return paragraph ? paragraph.slice(0, 240) : null;
}

function sourceNameFor(file: string, sourceType: SkillRegistrySourceType): string {
  if (sourceType === "codex_skill") return basename(dirname(file));
  return basename(file, ".md");
}

function runtimesFor(sourceType: SkillRegistrySourceType, skillType: string): { allowed: SkillRegistryRuntime[]; preferred: SkillRegistryRuntime[] } {
  if (sourceType === "codex_skill") {
    const allowed: SkillRegistryRuntime[] = skillType === "evidence" ? ["codex_cli", "codex_mcp", "local_deterministic"] : ["codex_cli", "codex_mcp"];
    return {
      allowed,
      preferred: ["codex_cli"]
    };
  }

  const allowed: SkillRegistryRuntime[] =
    skillType === "evidence" ? ["claude_cli", "claude_code_mcp", "local_deterministic"] : ["claude_cli", "claude_code_mcp"];
  return {
    allowed,
    preferred: ["claude_cli"]
  };
}

function candidateId(sourceType: SkillRegistrySourceType, scope: SkillRegistryScope, relativePath: string, contentHash: string): string {
  return `${sourceType}:${scope}:${slugify(relativePath)}:${contentHash.slice(7, 19)}`;
}

function skillIdFor(sourceType: SkillRegistrySourceType, scope: SkillRegistryScope, relativePath: string): string {
  return `${sourceType}:${scope}:${slugify(relativePath.replace(/\/?SKILL\.md$/i, "").replace(/\.md$/i, ""))}`;
}

function slugify(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
