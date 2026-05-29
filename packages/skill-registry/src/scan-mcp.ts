import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { classifySkillCandidate } from "./classifier";
import { stringFrom, stringListFrom } from "./frontmatter";
import { collectFiles, directoryExists, fileExists, hashString } from "./scan-file-utils";
import type { SkillRegistryCandidate } from "./types";
import {
  candidateId,
  classificationFlagsFor,
  recordFrom,
  runtimesFor,
  skillIdFor
} from "./scan-shared";

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

export async function scanMcpConfigs(rootDir: string, warnings: string[]): Promise<SkillRegistryCandidate[]> {
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

export async function scanNativeConnectorManifests(rootDir: string, warnings: string[]): Promise<SkillRegistryCandidate[]> {
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
