import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { classifySkillCandidate } from "./classifier";
import { parseMarkdownFrontmatter, stringFrom, stringListFrom } from "./frontmatter";
import { normalizeEvidenceTaskSpecs } from "./evidence-task-specs";
import { scanMcpConfigs, scanNativeConnectorManifests } from "./scan-mcp";
import {
  collectFiles,
  directoryExists,
  executionSnapshotFor,
  hashSkillDirectory,
  maxMarkdownParseBytes,
  normalizeRelativePath,
  readMarkdownForScan
} from "./scan-file-utils";
import {
  candidateId,
  classificationFlagsFor,
  declaredToolsFrom,
  duplicateGroupsFor,
  dynamicShellBlocksFrom,
  firstParagraph,
  runtimesFor,
  skillIdFor,
  sourceNameFor,
  summaryFor,
  userScopePrefix
} from "./scan-shared";
import type {
  ScanAgentSkillsInput,
  ScanAgentSkillsResult,
  SkillRegistryCandidate,
  SkillRegistryScope,
  SkillRegistrySourceType
} from "./types";

type DiscoveryTarget = {
  rootDir: string;
  pattern: "skill_directory" | "markdown";
  sourceType: SkillRegistrySourceType;
  scope: SkillRegistryScope;
};

export async function scanAgentSkills(input: ScanAgentSkillsInput): Promise<ScanAgentSkillsResult> {
  const rootDir = resolve(input.rootDir);
  const warnings: string[] = [];
  const targets = discoveryTargets(rootDir, input);
  const [candidateGroups, mcpCandidates, nativeConnectorCandidates] = await Promise.all([
    Promise.all(targets.map((target) => scanTarget(target, rootDir, warnings))),
    scanMcpConfigs(rootDir, warnings),
    scanNativeConnectorManifests(rootDir, warnings)
  ]);
  const scannedCandidates = [...candidateGroups.flat(), ...mcpCandidates, ...nativeConnectorCandidates].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  const duplicateGroups = duplicateGroupsFor(scannedCandidates);
  const duplicateCandidateIds = new Set(duplicateGroups.flatMap((group) => group.candidates.map((candidate) => candidate.id)));
  const candidates = scannedCandidates.map((candidate) =>
    duplicateCandidateIds.has(candidate.id)
      ? {
          ...candidate,
          warnings: [...candidate.warnings, "Duplicate display name detected; registry identity will use source fingerprint."]
        }
      : candidate
  );

  return {
    rootDir,
    scannedAt: new Date().toISOString(),
    candidates,
    warnings,
    duplicateGroups,
    summary: summaryFor(candidates, warnings)
  };
}

function discoveryTargets(rootDir: string, input: ScanAgentSkillsInput): DiscoveryTarget[] {
  const targets: DiscoveryTarget[] = [
    {
      rootDir: join(rootDir, ".agents", "skills"),
      pattern: "skill_directory",
      sourceType: "codex_skill",
      scope: "repo"
    },
    {
      rootDir: join(rootDir, ".claude", "skills"),
      pattern: "skill_directory",
      sourceType: "claude_skill",
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
        pattern: "skill_directory",
        sourceType: "codex_skill",
        scope: "user"
      },
      {
        rootDir: input.userClaudeSkillsDir ?? join(homedir(), ".claude", "skills"),
        pattern: "skill_directory",
        sourceType: "claude_skill",
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

async function scanTarget(target: DiscoveryTarget, workspaceRoot: string, warnings: string[]) {
  const exists = await directoryExists(target.rootDir);
  if (!exists) return [];

  const files = await collectFiles(target.rootDir, warnings);
  const matchingFiles = files.filter((file) => {
    if (target.pattern === "skill_directory") return basename(file) === "SKILL.md";
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
  const markdown = await readMarkdownForScan(input.file);
  const skillDirectory = dirname(input.file);
  const directoryHash =
    input.target.pattern === "skill_directory" ? await hashSkillDirectory(skillDirectory, input.file) : null;
  const parsed = parseMarkdownFrontmatter(markdown.contentForParse);
  const declaredTools = declaredToolsFrom(parsed.frontmatter, stringListFrom);
  const evidenceTaskSpecs = normalizeEvidenceTaskSpecs(parsed.frontmatter.evidence_tasks ?? parsed.frontmatter.evidenceTasks);
  const dryRunMetadata = recordFrom(parsed.frontmatter.dry_run ?? parsed.frontmatter.dryRun);
  const dynamicShell = dynamicShellBlocksFrom(parsed.body);
  const sourceRelativePath =
    input.target.scope === "user"
      ? normalizeRelativePath(join(userScopePrefix(input.target.sourceType), relative(input.target.rootDir, input.file)))
      : normalizeRelativePath(relative(input.workspaceRoot, input.file));
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
  const contentHash = directoryHash?.contentHash ?? markdown.contentHash;
  const runtimePlan = runtimesFor(input.target.sourceType, classification.skillType);
  const warnings = [...classification.warnings, ...evidenceTaskSpecs.warnings];
  const executionSnapshot = executionSnapshotFor({
    relativePath: sourceRelativePath,
    markdown: markdown.contentForParse,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    sourceHash: contentHash,
    entrypointContentHash: markdown.contentHash,
    sourceFileTruncated: markdown.truncated,
    supportingFiles: directoryHash?.supportingFileSnapshots ?? []
  });

  if (parsed.frontmatter.parse_error) warnings.push(String(parsed.frontmatter.parse_error));
  if (!description) warnings.push("Missing description metadata; review before enabling.");
  if (markdown.truncated) warnings.push(`Large skill file was parsed from the first ${maxMarkdownParseBytes} bytes only.`);
  if (executionSnapshot.truncated) {
    warnings.push("Executable skill body snapshot was truncated; live Claude execution requires a smaller skill entrypoint.");
  }
  if (dynamicShell.blocks.length > 0) {
    warnings.push("Dynamic shell block detected; review generated commands and side effects.");
  }
  if (directoryHash) {
    warnings.push(...directoryHash.warnings);
  }

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
    evidenceTasks: evidenceTaskSpecs.tasks,
    metadata: {
      frontmatter: parsed.frontmatter,
      source_directory: skillDirectory,
      content_truncated_for_parse: markdown.truncated,
      content_file_hash: markdown.contentHash,
      directory_hash: directoryHash?.contentHash ?? null,
      supporting_files: directoryHash?.supportingFiles ?? [],
      supporting_file_count: directoryHash?.supportingFileCount ?? 0,
      supporting_file_bytes: directoryHash?.supportingFileBytes ?? 0,
      dynamic_shell_blocks: dynamicShell.blocks,
      dynamic_shell_block_count: dynamicShell.blocks.length,
      execution_snapshot: executionSnapshot,
      classification_flags: classificationFlagsFor({
        name,
        description,
        body: parsed.body,
        declaredTools
      }),
      environments: stringListFrom(parsed.frontmatter.environments ?? parsed.frontmatter.environment),
      evidence_tasks: evidenceTaskSpecs.tasks,
      supports_dry_run: booleanFrom(parsed.frontmatter.supports_dry_run ?? parsed.frontmatter.supportsDryRun) || Object.keys(dryRunMetadata).length > 0,
      dry_run: dryRunMetadata,
      required_evidence: stringListFrom(parsed.frontmatter.required_evidence ?? parsed.frontmatter.requiredEvidence),
      approver_roles: stringListFrom(parsed.frontmatter.approver_roles ?? parsed.frontmatter.approverRoles),
      owners: stringListFrom(parsed.frontmatter.owners)
    }
  };
}

function booleanFrom(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
