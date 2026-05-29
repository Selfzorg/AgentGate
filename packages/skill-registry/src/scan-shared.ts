import { basename, dirname } from "node:path";
import type {
  SkillRegistryCandidate,
  SkillRegistryRuntime,
  SkillRegistryScope,
  SkillRegistrySourceType
} from "./types";

export function declaredToolsFrom(frontmatter: Record<string, unknown>, stringListFrom: (value: unknown) => string[]): string[] {
  return [
    ...new Set([
      ...stringListFrom(frontmatter["allowed-tools"]),
      ...stringListFrom(frontmatter.allowed_tools),
      ...stringListFrom(frontmatter.tools)
    ])
  ];
}

export function firstParagraph(body: string): string | null {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((entry) => entry.replace(/^#+\s*/, "").trim())
    .find((entry) => entry.length > 0);
  return paragraph ? paragraph.slice(0, 240) : null;
}

export function dynamicShellBlocksFrom(body: string): {
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

export function classificationFlagsFor(input: {
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

export function sourceNameFor(file: string, sourceType: SkillRegistrySourceType): string {
  if (sourceType === "codex_skill" || sourceType === "claude_skill") return basename(dirname(file));
  return basename(file, ".md");
}

export function runtimesFor(sourceType: SkillRegistrySourceType, skillType: string): { allowed: SkillRegistryRuntime[]; preferred: SkillRegistryRuntime[] } {
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

  const allowed: SkillRegistryRuntime[] =
    skillType === "evidence" ? ["claude_cli", "claude_code_mcp", "local_deterministic"] : ["claude_cli", "claude_code_mcp"];
  return {
    allowed,
    preferred: ["claude_cli"]
  };
}

export function duplicateGroupsFor(candidates: SkillRegistryCandidate[]) {
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

export function summaryFor(candidates: SkillRegistryCandidate[], warnings: string[]) {
  return {
    total: candidates.length,
    bySourceType: countBy(candidates, (candidate) => candidate.sourceType),
    byRiskLevel: countBy(candidates, (candidate) => candidate.defaultRiskLevel),
    bySideEffectLevel: countBy(candidates, (candidate) => candidate.sideEffectLevel),
    warningCount: warnings.length + candidates.reduce((sum, candidate) => sum + candidate.warnings.length, 0)
  };
}

export function candidateId(sourceType: SkillRegistrySourceType, scope: SkillRegistryScope, relativePath: string, contentHash: string): string {
  return `${sourceType}:${scope}:${slugify(relativePath)}:${contentHash.slice(7, 19)}`;
}

export function skillIdFor(sourceType: SkillRegistrySourceType, scope: SkillRegistryScope, relativePath: string): string {
  return `${sourceType}:${scope}:${slugify(relativePath.replace(/\/?SKILL\.md$/i, "").replace(/\.md$/i, ""))}`;
}

export function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function userScopePrefix(sourceType: SkillRegistrySourceType): string {
  if (sourceType === "codex_skill") return "~/.codex/skills";
  if (sourceType === "claude_skill") return "~/.claude/skills";
  if (sourceType === "claude_command") return "~/.claude/commands";
  if (sourceType === "claude_subagent") return "~/.claude/agents";
  return "~";
}

function countBy<T>(entries: T[], keyFor: (entry: T) => string) {
  return entries.reduce<Record<string, number>>((counts, entry) => {
    const key = keyFor(entry);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
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
