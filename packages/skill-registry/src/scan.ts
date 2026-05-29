import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
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
const maxMarkdownParseBytes = 1_000_000;
const maxSupportingFilesInMetadata = 100;
const knownAgentGateMcpTools = [
  {
    tool: "agentgate_run_tests",
    description: "Run tests through the AgentGate MCP proxy.",
    declaredTools: ["mcp.agentgate.agentgate_run_tests"]
  },
  {
    tool: "agentgate_create_pr",
    description: "Create a pull request through the AgentGate MCP proxy.",
    declaredTools: ["mcp.agentgate.agentgate_create_pr"]
  },
  {
    tool: "agentgate_merge_pr",
    description: "Merge a pull request through the AgentGate MCP proxy.",
    declaredTools: ["mcp.agentgate.agentgate_merge_pr"]
  },
  {
    tool: "agentgate_deploy_staging",
    description: "Deploy to staging through the AgentGate MCP proxy.",
    declaredTools: ["mcp.agentgate.agentgate_deploy_staging"]
  },
  {
    tool: "agentgate_deploy_production",
    description: "Deploy to production through the AgentGate MCP proxy.",
    declaredTools: ["mcp.agentgate.agentgate_deploy_production"]
  },
  {
    tool: "agentgate_apply_migration",
    description: "Apply a database migration through the AgentGate MCP proxy.",
    declaredTools: ["mcp.agentgate.agentgate_apply_migration"]
  },
  {
    tool: "agentgate_drop_table",
    description: "Drop a database table through the AgentGate MCP proxy.",
    declaredTools: ["mcp.agentgate.agentgate_drop_table"]
  }
];

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
  const declaredTools = declaredToolsFrom(parsed.frontmatter);
  const dynamicShell = dynamicShellBlocksFrom(parsed.body);
  const sourceRelativePath =
    input.target.scope === "user"
      ? join(userScopePrefix(input.target.sourceType), relative(input.target.rootDir, input.file))
      : relative(input.workspaceRoot, input.file);
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
  const warnings = [...classification.warnings];

  if (parsed.frontmatter.parse_error) warnings.push(String(parsed.frontmatter.parse_error));
  if (!description) warnings.push("Missing description metadata; review before enabling.");
  if (markdown.truncated) warnings.push(`Large skill file was parsed from the first ${maxMarkdownParseBytes} bytes only.`);
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
      classification_flags: classificationFlagsFor({
        name,
        description,
        body: parsed.body,
        declaredTools
      }),
      environments: stringListFrom(parsed.frontmatter.environments ?? parsed.frontmatter.environment),
      required_evidence: stringListFrom(parsed.frontmatter.required_evidence ?? parsed.frontmatter.requiredEvidence),
      approver_roles: stringListFrom(parsed.frontmatter.approver_roles ?? parsed.frontmatter.approverRoles),
      owners: stringListFrom(parsed.frontmatter.owners)
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

async function collectFiles(rootDir: string, warnings: string[]): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.flatMap((entry) => {
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlink during skill scan: ${join(rootDir, entry.name)}`);
        return [];
      }
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
      const fullPath = join(rootDir, entry.name);
      return entry.isDirectory() ? [collectFiles(fullPath, warnings)] : [Promise.resolve([fullPath])];
    })
  );
  return nested.flat();
}

async function hashSkillDirectory(
  skillDirectory: string,
  entryFile: string
): Promise<{
  contentHash: string;
  supportingFiles: string[];
  supportingFileCount: number;
  supportingFileBytes: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const files = (await collectFiles(skillDirectory, warnings)).sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  const supportingFiles: string[] = [];
  let supportingFileBytes = 0;

  for (const file of files) {
    const fileStat = await stat(file);
    const relativeFile = relative(skillDirectory, file);
    hash.update(`path:${relativeFile}\nsize:${fileStat.size}\n`);
    await updateHashFromFile(hash, file);
    hash.update("\n");

    if (file !== entryFile) {
      supportingFileBytes += fileStat.size;
      if (supportingFiles.length < maxSupportingFilesInMetadata) supportingFiles.push(relativeFile);
    }
  }

  if (files.length - 1 > maxSupportingFilesInMetadata) {
    warnings.push(`Supporting file metadata was truncated to ${maxSupportingFilesInMetadata} entries.`);
  }

  return {
    contentHash: `sha256:${hash.digest("hex")}`,
    supportingFiles,
    supportingFileCount: Math.max(files.length - 1, 0),
    supportingFileBytes,
    warnings
  };
}

async function updateHashFromFile(hash: ReturnType<typeof createHash>, file: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
  });
}

async function readMarkdownForScan(file: string): Promise<{
  contentForParse: string;
  contentHash: string;
  truncated: boolean;
}> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let retainedBytes = 0;
    let truncated = false;
    const stream = createReadStream(file);

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      if (retainedBytes >= maxMarkdownParseBytes) {
        truncated = true;
        return;
      }

      const remaining = maxMarkdownParseBytes - retainedBytes;
      const retained = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      chunks.push(retained);
      retainedBytes += retained.length;
      if (buffer.length > remaining) truncated = true;
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolvePromise({
        contentForParse: Buffer.concat(chunks).toString("utf8"),
        contentHash: `sha256:${hash.digest("hex")}`,
        truncated
      });
    });
  });
}

async function scanMcpConfigs(rootDir: string, warnings: string[]): Promise<SkillRegistryCandidate[]> {
  const candidates: SkillRegistryCandidate[] = [];
  const mcpJsonPath = join(rootDir, ".mcp.json");
  const codexTomlPath = join(rootDir, ".codex", "config.toml");

  if (await fileExists(mcpJsonPath)) {
    candidates.push(...(await candidatesFromMcpJson(mcpJsonPath, rootDir, warnings)));
  }

  if (await fileExists(codexTomlPath)) {
    candidates.push(...(await candidatesFromCodexToml(codexTomlPath, rootDir, warnings)));
  }

  return candidates;
}

async function scanNativeConnectorManifests(rootDir: string, warnings: string[]): Promise<SkillRegistryCandidate[]> {
  const manifestFiles = await nativeConnectorManifestFiles(rootDir, warnings);
  const candidateGroups = await Promise.all(manifestFiles.map((file) => candidatesFromNativeConnectorManifest(file, rootDir, warnings)));
  return candidateGroups.flat();
}

async function nativeConnectorManifestFiles(rootDir: string, warnings: string[]) {
  const directFiles = [
    join(rootDir, "agentgate.connectors.json"),
    join(rootDir, ".agentgate", "connectors.json"),
    join(rootDir, ".agentgate", "connector-manifest.json"),
    join(rootDir, ".agentgate", "connector-manifest.yaml"),
    join(rootDir, ".agentgate", "connector-manifest.yml")
  ];
  const files: string[] = [];

  for (const file of directFiles) {
    if (await fileExists(file)) files.push(file);
  }

  const connectorsDir = join(rootDir, ".agentgate", "connectors");
  if (await directoryExists(connectorsDir)) {
    const nested = await collectFiles(connectorsDir, warnings);
    files.push(...nested.filter((file) => [".json", ".yaml", ".yml"].includes(extname(file).toLowerCase())));
  }

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

async function candidatesFromNativeConnectorManifest(
  file: string,
  rootDir: string,
  warnings: string[]
): Promise<SkillRegistryCandidate[]> {
  const raw = await readFile(file, "utf8");
  const relativePath = relative(rootDir, file);
  const parsed = parseStructuredManifest(raw, extname(file));

  if (!parsed.ok) {
    warnings.push(`Invalid native connector manifest: ${relativePath}`);
    return [];
  }

  return connectorEntriesFrom(parsed.value).map((entry, index) =>
    nativeConnectorCandidate({
      file,
      relativePath,
      manifestHash: hashString(raw),
      entry,
      index
    })
  );
}

function parseStructuredManifest(raw: string, extension: string): { ok: true; value: unknown } | { ok: false } {
  try {
    if (extension.toLowerCase() === ".json") return { ok: true, value: JSON.parse(raw) };
    return { ok: true, value: parseYaml(raw) };
  } catch {
    return { ok: false };
  }
}

function connectorEntriesFrom(value: unknown): Array<Record<string, unknown>> {
  const root = recordFrom(value);
  const candidates = [
    root.connectors,
    root.native_connectors,
    root.nativeConnectors,
    root.connector,
    Object.keys(root).length > 0 ? root : null
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(recordFrom).filter((entry) => Object.keys(entry).length > 0);
    const record = recordFrom(candidate);
    if (Object.keys(record).length > 0 && Object.values(record).every((entry) => Object.keys(recordFrom(entry)).length > 0)) {
      return Object.entries(record).map(([id, entry]) => ({
        connector_id: id,
        ...recordFrom(entry)
      }));
    }
    if (Object.keys(record).length > 0 && (record.id || record.connector_id || record.name || record.tools || record.operations)) {
      return [record];
    }
  }

  return [];
}

function nativeConnectorCandidate(input: {
  file: string;
  relativePath: string;
  manifestHash: string;
  entry: Record<string, unknown>;
  index: number;
}): SkillRegistryCandidate {
  const connectorId =
    stringFrom(input.entry.connector_id, input.entry.connectorId, input.entry.id, input.entry.name) ?? `connector-${input.index + 1}`;
  const sourcePath = `${input.relativePath}#${connectorId}`;
  const contentHash = hashString(`${input.manifestHash}:${connectorId}:${JSON.stringify(input.entry)}`);
  const name = stringFrom(input.entry.name, input.entry.title, connectorId) ?? connectorId;
  const description = stringFrom(input.entry.description) ?? `Native connector "${name}" discovered from local manifest.`;
  const declaredTools = [
    ...new Set([
      ...stringListFrom(input.entry.tools),
      ...stringListFrom(input.entry.allowed_tools),
      ...stringListFrom(input.entry.allowedTools),
      ...stringListFrom(input.entry.operations),
      ...stringListFrom(input.entry.scopes)
    ])
  ];
  const classification = classifySkillCandidate({
    sourceType: "native_connector",
    name,
    description,
    body: JSON.stringify(input.entry),
    declaredTools
  });
  const runtimePlan = runtimesFor("native_connector", classification.skillType);

  return {
    id: candidateId("native_connector", "repo", sourcePath, contentHash),
    skillId: skillIdFor("native_connector", "repo", sourcePath),
    name,
    description,
    sourceType: "native_connector",
    scope: "repo",
    sourcePath: input.file,
    relativePath: sourcePath,
    contentHash,
    declaredTools,
    skillType: classification.skillType,
    sideEffectLevel: classification.sideEffectLevel,
    defaultRiskLevel: classification.defaultRiskLevel,
    allowedRuntimes: runtimePlan.allowed,
    preferredRuntimes: runtimePlan.preferred,
    warnings: [...classification.warnings],
    metadata: {
      connector_id: connectorId,
      manifest_path: input.relativePath,
      manifest_index: input.index,
      classification_flags: classificationFlagsFor({
        name,
        description,
        body: JSON.stringify(input.entry),
        declaredTools
      }),
      raw_manifest: input.entry
    }
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch {
    return false;
  }
}

async function candidatesFromMcpJson(file: string, rootDir: string, warnings: string[]): Promise<SkillRegistryCandidate[]> {
  const raw = await readFile(file, "utf8");
  const relativePath = relative(rootDir, file);
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push(`Invalid MCP JSON config: ${relativePath}`);
    return [
      mcpServerCandidate({
        rootDir,
        file,
        relativePath,
        serverName: "invalid-json",
        configHash: hashString(raw),
        warnings: ["Invalid MCP JSON config."]
      })
    ];
  }

  const servers = recordFrom(recordFrom(parsed).mcpServers);
  return Object.keys(servers).flatMap((serverName) =>
    mcpCandidatesForServer({
      rootDir,
      file,
      relativePath,
      serverName,
      configHash: hashString(raw),
      configSource: ".mcp.json"
    })
  );
}

async function candidatesFromCodexToml(file: string, rootDir: string, warnings: string[]): Promise<SkillRegistryCandidate[]> {
  const raw = await readFile(file, "utf8");
  const relativePath = relative(rootDir, file);
  const serverNames = [...raw.matchAll(/^\s*\[mcp_servers\.([^\]\s]+)\]\s*$/gm)].map((match) =>
    match[1]?.replace(/^"|"$/g, "").trim()
  );

  if (serverNames.length === 0) {
    warnings.push(`No MCP server blocks found in Codex config: ${relativePath}`);
    return [];
  }

  return [...new Set(serverNames.filter((name): name is string => Boolean(name)))].flatMap((serverName) =>
    mcpCandidatesForServer({
      rootDir,
      file,
      relativePath,
      serverName,
      configHash: hashString(raw),
      configSource: ".codex/config.toml"
    })
  );
}

function mcpCandidatesForServer(input: {
  rootDir: string;
  file: string;
  relativePath: string;
  serverName: string;
  configHash: string;
  configSource: string;
}): SkillRegistryCandidate[] {
  if (input.serverName === "agentgate") {
    return knownAgentGateMcpTools.map((tool) =>
      mcpToolCandidate({
        ...input,
        toolName: tool.tool,
        description: tool.description,
        declaredTools: tool.declaredTools,
        warnings: []
      })
    );
  }

  return [
    mcpServerCandidate({
      ...input,
      warnings: [`MCP server "${input.serverName}" is configured, but local tool metadata is unavailable.`]
    })
  ];
}

function mcpToolCandidate(input: {
  rootDir: string;
  file: string;
  relativePath: string;
  serverName: string;
  toolName: string;
  description: string;
  declaredTools: string[];
  configHash: string;
  configSource: string;
  warnings: string[];
}): SkillRegistryCandidate {
  const sourcePath = `${input.relativePath}#${input.serverName}.${input.toolName}`;
  const contentHash = hashString(`${input.configHash}:${input.serverName}:${input.toolName}`);
  const name = `mcp.${input.serverName}.${input.toolName}`;
  const classification = classifySkillCandidate({
    sourceType: "mcp_tool",
    name,
    description: input.description,
    body: "",
    declaredTools: input.declaredTools
  });
  const runtimePlan = runtimesFor("mcp_tool", classification.skillType);

  return {
    id: candidateId("mcp_tool", "repo", sourcePath, contentHash),
    skillId: skillIdFor("mcp_tool", "repo", sourcePath),
    name,
    description: input.description,
    sourceType: "mcp_tool",
    scope: "repo",
    sourcePath: input.file,
    relativePath: sourcePath,
    contentHash,
    declaredTools: input.declaredTools,
    skillType: classification.skillType,
    sideEffectLevel: classification.sideEffectLevel,
    defaultRiskLevel: classification.defaultRiskLevel,
    allowedRuntimes: runtimePlan.allowed,
    preferredRuntimes: runtimePlan.preferred,
    warnings: [...classification.warnings, ...input.warnings],
    metadata: {
      mcp_server: input.serverName,
      mcp_tool: input.toolName,
      config_source: input.configSource
    }
  };
}

function mcpServerCandidate(input: {
  rootDir: string;
  file: string;
  relativePath: string;
  serverName: string;
  configHash: string;
  configSource?: string | undefined;
  warnings: string[];
}): SkillRegistryCandidate {
  const sourcePath = `${input.relativePath}#${input.serverName}`;
  const contentHash = hashString(`${input.configHash}:${input.serverName}:server-only`);
  const name = `mcp.${input.serverName}`;
  const description = `MCP server "${input.serverName}" discovered without local tool metadata.`;
  const classification = classifySkillCandidate({
    sourceType: "mcp_tool",
    name,
    description,
    body: "",
    declaredTools: []
  });
  const runtimePlan = runtimesFor("mcp_tool", classification.skillType);

  return {
    id: candidateId("mcp_tool", "repo", sourcePath, contentHash),
    skillId: skillIdFor("mcp_tool", "repo", sourcePath),
    name,
    description,
    sourceType: "mcp_tool",
    scope: "repo",
    sourcePath: input.file,
    relativePath: sourcePath,
    contentHash,
    declaredTools: [],
    skillType: classification.skillType,
    sideEffectLevel: classification.sideEffectLevel,
    defaultRiskLevel: classification.defaultRiskLevel,
    allowedRuntimes: runtimePlan.allowed,
    preferredRuntimes: runtimePlan.preferred,
    warnings: [...classification.warnings, ...input.warnings],
    metadata: {
      mcp_server: input.serverName,
      config_source: input.configSource ?? "unknown",
      tool_metadata_available: false
    }
  };
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

function dynamicShellBlocksFrom(body: string): {
  blocks: Array<{ language: string; preview: string }>;
} {
  const blocks = [...body.matchAll(/```(bash|sh|shell|zsh|terminal)\s*\n([\s\S]*?)```/gi)].map((match) => ({
    language: (match[1] ?? "shell").toLowerCase(),
    preview: (match[2] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join("\n")
      .slice(0, 500)
  }));

  return {
    blocks
  };
}

function classificationFlagsFor(input: {
  name: string;
  description: string | null;
  body: string;
  declaredTools: string[];
}) {
  const haystack = [input.name, input.description, input.body, input.declaredTools.join(" ")].filter(Boolean).join("\n");

  return {
    read_only: /\b(read|inspect|list|grep|verify|check|status)\b/i.test(haystack) && !/\b(write|edit|deploy|merge|delete|drop|truncate)\b/i.test(haystack),
    simulated: /\b(simulat|dry[- ]run|preview)\b/i.test(haystack),
    mutating: /\b(write|edit|create|apply|deploy|merge|push|migrate)\b/i.test(haystack),
    production_capable: /\b(prod|production|live|customer|public)\b/i.test(haystack),
    destructive: /\b(drop|truncate|destroy|delete|remove|force)\b/i.test(haystack)
  };
}

function sourceNameFor(file: string, sourceType: SkillRegistrySourceType): string {
  if (sourceType === "codex_skill" || sourceType === "claude_skill") return basename(dirname(file));
  return basename(file, ".md");
}

function runtimesFor(sourceType: SkillRegistrySourceType, skillType: string): { allowed: SkillRegistryRuntime[]; preferred: SkillRegistryRuntime[] } {
  if (sourceType === "mcp_tool") {
    return {
      allowed: ["mcp_tool", "claude_code_mcp", "codex_mcp"],
      preferred: ["mcp_tool"]
    };
  }

  if (sourceType === "native_connector") {
    return {
      allowed: ["native_connector"],
      preferred: ["native_connector"]
    };
  }

  if (sourceType === "codex_skill") {
    const allowed: SkillRegistryRuntime[] = skillType === "evidence" ? ["codex_cli", "codex_mcp", "local_deterministic"] : ["codex_cli", "codex_mcp"];
    return {
      allowed,
      preferred: ["codex_cli"]
    };
  }

  if (sourceType === "claude_skill") {
    const allowed: SkillRegistryRuntime[] =
      skillType === "evidence" ? ["claude_cli", "claude_code_mcp", "local_deterministic"] : ["claude_cli", "claude_code_mcp"];
    return {
      allowed,
      preferred: ["claude_cli"]
    };
  }

  const allowed: SkillRegistryRuntime[] =
    skillType === "evidence" ? ["claude_cli", "claude_code_mcp", "local_deterministic"] : ["claude_cli", "claude_code_mcp"];
  return {
    allowed,
    preferred: ["claude_cli"]
  };
}

function duplicateGroupsFor(candidates: SkillRegistryCandidate[]) {
  const groups = new Map<string, SkillRegistryCandidate[]>();
  for (const candidate of candidates) {
    const normalizedName = normalizeName(candidate.name);
    const group = groups.get(normalizedName) ?? [];
    group.push(candidate);
    groups.set(normalizedName, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([normalizedName, group]) => ({
      normalizedName,
      candidates: group.map((candidate) => ({
        id: candidate.id,
        skillId: candidate.skillId,
        name: candidate.name,
        sourceType: candidate.sourceType,
        scope: candidate.scope,
        relativePath: candidate.relativePath,
        contentHash: candidate.contentHash
      }))
    }));
}

function summaryFor(candidates: SkillRegistryCandidate[], warnings: string[]) {
  return {
    total: candidates.length,
    bySourceType: countBy(candidates, (candidate) => candidate.sourceType),
    byRiskLevel: countBy(candidates, (candidate) => candidate.defaultRiskLevel),
    bySideEffectLevel: countBy(candidates, (candidate) => candidate.sideEffectLevel),
    warningCount: warnings.length + candidates.reduce((sum, candidate) => sum + candidate.warnings.length, 0)
  };
}

function countBy<T>(entries: T[], keyFor: (entry: T) => string) {
  return entries.reduce<Record<string, number>>((counts, entry) => {
    const key = keyFor(entry);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
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

function normalizeName(value: string): string {
  return slugify(value) || "unnamed";
}

function hashString(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function userScopePrefix(sourceType: SkillRegistrySourceType): string {
  if (sourceType === "codex_skill") return "~/.codex/skills";
  if (sourceType === "claude_skill") return "~/.claude/skills";
  if (sourceType === "claude_command") return "~/.claude/commands";
  if (sourceType === "claude_subagent") return "~/.claude/agents";
  return "~";
}
