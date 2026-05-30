import type { ResolvedSkill } from "@agentgate/core-types";
import {
  resolveRegistryCandidate,
  type RegistryResolutionMatch,
  type SkillRegistryCandidate,
  type SkillRegistryRiskLevel,
  type SkillRegistryRuntime,
  type SkillRegistrySideEffectLevel,
  type SkillRegistrySkillType,
  type SkillRegistrySourceType
} from "@agentgate/skill-registry";
import type { PrismaClient } from "@prisma/client";
import { normalizeRequiredChecks } from "./imported-skill-governance";

export type ImportedRegistryResolution = {
  selected: (RegistryResolutionMatch & { skillVersionId: string; skillVersion: string; category: string }) | null;
  alternatives: Array<RegistryResolutionMatch & { skillVersionId: string; skillVersion: string; category: string }>;
  candidates: SkillRegistryCandidate[];
};

export async function resolveImportedRegistrySkill(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    rawAction: string;
    toolName?: string | undefined;
    source?: string | undefined;
    context?: Record<string, unknown> | undefined;
  }
): Promise<{ resolvedSkill: ResolvedSkill | null; registryResolution: ImportedRegistryResolution }> {
  const candidates = await activeImportedCandidates(prisma, input.tenantId, input.workspaceId);
  const resolutionText = [input.rawAction, registryHintFromContext(input.context)].filter(Boolean).join(" ");
  const resolution = resolveRegistryCandidate({
    candidates,
    rawAction: resolutionText,
    toolName: input.toolName
  });
  const explicitRegistryHint = hasRegistryHint(input.context);
  const selected = resolution.selected && isResolutionAllowedForSource(resolution.selected, input.source, explicitRegistryHint, input.context)
    ? withVersionMetadata(resolution.selected, candidates)
    : null;
  const alternatives = resolution.alternatives.flatMap((match) => {
    if (!isResolutionAllowedForSource(match, input.source, explicitRegistryHint, input.context)) return [];
    const enriched = withVersionMetadata(match, candidates);
    return enriched ? [enriched] : [];
  });

  if (!selected || selected.confidence < 0.5) {
    return {
      resolvedSkill: null,
      registryResolution: {
        selected,
        alternatives,
        candidates
      }
    };
  }

  return {
    resolvedSkill: {
      skill_id: selected.candidate.skillId,
      skill_version: selected.skillVersion,
      category: selected.category,
      default_risk_level: selected.candidate.defaultRiskLevel,
      confidence: selected.confidence,
      resolver_reason: `Action resolved from imported registry metadata via ${selected.matchedField}.`,
      resolver_source: "imported_registry",
      matched_field: selected.matchedField,
      policy_aliases: stringArray(configForCandidate(selected.candidate).policy_aliases),
      required_checks: normalizeRequiredChecks(configForCandidate(selected.candidate).required_checks),
      source_fingerprint: {
        source_type: selected.candidate.sourceType,
        path: selected.candidate.relativePath,
        content_hash: selected.candidate.contentHash,
        skill_version_id: selected.skillVersionId
      },
      alternatives: alternatives.map((alternative) => ({
        skill_id: alternative.candidate.skillId,
        confidence: alternative.confidence,
        matched_field: alternative.matchedField
      }))
    },
    registryResolution: {
      selected,
      alternatives,
      candidates
    }
  };
}

export async function activeImportedCandidates(
  prisma: PrismaClient,
  tenantId: string,
  workspaceId: string
): Promise<SkillRegistryCandidate[]> {
  const skills = await prisma.skill.findMany({
    where: {
      tenantId,
      workspaceId,
      status: "active"
    },
    include: {
      versions: {
        where: {
          status: "active"
        },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  return skills.flatMap((skill) => {
    const version = skill.versions[0];
    if (!version) return [];
    const config = recordFrom(version.config);
    const source = recordFrom(config.source);
    const sourceType = stringFrom(source.type);
    const path = stringFrom(source.path);
    const contentHash = stringFrom(source.content_hash);
    if (!sourceType || !path || !contentHash) return [];

    return [
      {
        id: `${sourceType}:db:${version.id}`,
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        sourceType: sourceTypeFor(sourceType),
        scope: scopeFor(stringFrom(source.scope)),
        sourcePath: path,
        relativePath: path,
        contentHash,
        declaredTools: stringArray(config.declared_tools),
        skillType: skillTypeFor(stringFrom(config.skill_type)),
        sideEffectLevel: sideEffectLevelFor(stringFrom(config.side_effect_level)),
        defaultRiskLevel: skill.defaultRiskLevel as SkillRegistryRiskLevel,
        allowedRuntimes: runtimeArray(config.allowed_runtimes),
        preferredRuntimes: runtimeArray(config.preferred_runtimes),
        warnings: stringArray(config.import_warnings),
        metadata: {
          imported_skill_record_id: skill.id,
          imported_skill_version_id: version.id,
          imported_version: version.version,
          category: skill.category,
          config
        }
      }
    ];
  });
}

export function serializeImportedRegistryMatch(
  match: (RegistryResolutionMatch & { skillVersionId?: string; skillVersion?: string; category?: string }) | null
) {
  if (!match) return null;
  return {
    skill_id: match.candidate.skillId,
    skill_version: match.skillVersion ?? null,
    skill_version_id: match.skillVersionId ?? null,
    name: match.candidate.name,
    source_type: match.candidate.sourceType,
    scope: match.candidate.scope,
    confidence: match.confidence,
    matched_field: match.matchedField,
    content_hash: match.candidate.contentHash,
    side_effect_level: match.candidate.sideEffectLevel,
    default_risk_level: match.candidate.defaultRiskLevel,
    warnings: match.candidate.warnings
  };
}

function withVersionMetadata(match: RegistryResolutionMatch, candidates: SkillRegistryCandidate[]) {
  const candidate = candidates.find((entry) => entry.id === match.candidate.id);
  if (!candidate) return null;
  const metadata = recordFrom(candidate.metadata);
  const skillVersionId = stringFrom(metadata.imported_skill_version_id);
  const skillVersion = stringFrom(metadata.imported_version);
  const category = stringFrom(metadata.category);
  if (!skillVersionId || !skillVersion || !category) return null;
  return {
    ...match,
    skillVersionId,
    skillVersion,
    category
  };
}

function configForCandidate(candidate: SkillRegistryCandidate) {
  return recordFrom(recordFrom(candidate.metadata).config);
}

function sourceTypeFor(value: string): SkillRegistrySourceType {
  if (
    value === "claude_skill" ||
    value === "claude_command" ||
    value === "claude_subagent" ||
    value === "mcp_tool" ||
    value === "native_connector" ||
    value === "demo_fixture"
  ) {
    return value;
  }
  return "codex_skill";
}

function scopeFor(value: string | null) {
  return value === "user" ? "user" : "repo";
}

function skillTypeFor(value: string | null): SkillRegistrySkillType {
  return value === "evidence" ? "evidence" : "execution";
}

function sideEffectLevelFor(value: string | null): SkillRegistrySideEffectLevel {
  if (value === "read_only" || value === "mutating") return value;
  return "simulated";
}

function runtimeArray(value: unknown): SkillRegistryRuntime[] {
  return stringArray(value).filter((entry): entry is SkillRegistryRuntime =>
    ["codex_cli", "codex_mcp", "claude_cli", "claude_code_mcp", "mcp_tool", "native_connector", "local_deterministic"].includes(entry)
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isResolutionAllowedForSource(
  match: RegistryResolutionMatch,
  source: string | undefined,
  explicitRegistryHint: boolean,
  context: Record<string, unknown> | undefined
) {
  if (explicitRegistryHint) return true;
  if (source === "claude-code" || source === "claude_code") {
    if (!isClaudeSourceType(match.candidate.sourceType)) return false;
    return isExplicitAgentSkillMatch(match) || isContextualAgentSkillBridgeAllowed(match, context);
  }
  if (source === "codex") return match.candidate.sourceType === "codex_skill";
  if (source === "mcp_proxy") {
    if (match.candidate.sourceType === "mcp_tool" || match.candidate.sourceType === "native_connector") return true;
    return isContextualAgentSkillBridgeAllowed(match, context);
  }
  if (source === "demo_harness") return match.candidate.sourceType === "demo_fixture";
  return true;
}

function isContextualAgentSkillBridgeAllowed(match: RegistryResolutionMatch, context: Record<string, unknown> | undefined) {
  if (!isClaudeSourceType(match.candidate.sourceType)) return false;
  if (match.confidence < 0.85) return false;

  const serviceTokens = tokensFor(stringFrom(context?.service) ?? "");
  if (serviceTokens.length === 0) return false;

  const candidateTokens = new Set(tokensFor([match.candidate.relativePath, match.candidate.name].join(" ")));
  return serviceTokens.every((token) => candidateTokens.has(token));
}

function isExplicitAgentSkillMatch(match: RegistryResolutionMatch) {
  if (match.matchedField === "skill_id" || match.matchedField === "path") return true;
  return match.matchedField === "name" && match.confidence >= 0.85;
}

function isClaudeSourceType(sourceType: string) {
  return sourceType === "claude_skill" || sourceType === "claude_command" || sourceType === "claude_subagent";
}

function registryHintFromContext(context: Record<string, unknown> | undefined) {
  if (!context) return null;
  return [
    stringFrom(context.requested_skill),
    stringFrom(context.requested_skill_id),
    stringFrom(context.requested_skill_name),
    stringFrom(context.original_user_prompt),
    stringFrom(context.user_intent)
  ]
    .filter(Boolean)
    .join(" ");
}

function hasRegistryHint(context: Record<string, unknown> | undefined) {
  return Boolean(registryHintFromContext(context));
}

function tokensFor(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
