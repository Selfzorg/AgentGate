import type {
  SkillRegistryRiskLevel,
  SkillRegistrySideEffectLevel,
  SkillRegistrySkillType,
  SkillRegistrySourceType
} from "./types";

const readOnlyToolPatterns = [/^read\b/i, /^grep\b/i, /^glob\b/i, /^ls\b/i, /^bash\(?(git status|git show|rg|ls|pwd|cat)\b/i];
const mutatingToolPatterns = [
  /write/i,
  /edit/i,
  /multiedit/i,
  /bash/i,
  /mcp(__|\.|:).*(merge|deploy|apply|create|delete|drop|truncate|migrate)/i
];
const highRiskTextPatterns = [/\bprod(?:uction)?\b/i, /\bdeploy\b/i, /\bmerge\b/i, /\bmigrate\b/i, /\bpush\b/i];
const criticalTextPatterns = [/\bdrop\b/i, /\btruncate\b/i, /\bdestroy\b/i, /\bdelete\b/i, /\bforce\b/i];
const evidenceTextPatterns = [/\bevidence\b/i, /\bverify\b/i, /\bcheck\b/i, /\bread[- ]only\b/i, /\bstatus\b/i];

export type SkillClassificationInput = {
  sourceType: SkillRegistrySourceType;
  name: string;
  description: string | null;
  body: string;
  declaredTools: string[];
};

export type SkillClassification = {
  skillType: SkillRegistrySkillType;
  sideEffectLevel: SkillRegistrySideEffectLevel;
  defaultRiskLevel: SkillRegistryRiskLevel;
  warnings: string[];
};

export function classifySkillCandidate(input: SkillClassificationInput): SkillClassification {
  const haystack = [input.name, input.description, input.body, input.declaredTools.join(" ")].filter(Boolean).join("\n");
  const hasCriticalText = criticalTextPatterns.some((pattern) => pattern.test(haystack));
  const hasHighRiskText = highRiskTextPatterns.some((pattern) => pattern.test(haystack));
  const hasMutatingTools = input.declaredTools.some(
    (tool) =>
      mutatingToolPatterns.some((pattern) => pattern.test(tool)) &&
      !readOnlyToolPatterns.some((pattern) => pattern.test(tool))
  );
  const hasReadOnlyTools =
    input.declaredTools.length > 0 &&
    input.declaredTools.every((tool) => readOnlyToolPatterns.some((pattern) => pattern.test(tool)));
  const looksLikeEvidence = evidenceTextPatterns.some((pattern) => pattern.test(haystack));

  const sideEffectLevel = sideEffectLevelFor({
    hasCriticalText,
    hasHighRiskText,
    hasMutatingTools,
    hasReadOnlyTools,
    sourceType: input.sourceType
  });
  const defaultRiskLevel = riskLevelFor(sideEffectLevel, hasCriticalText, hasHighRiskText);
  const warnings = warningsFor({
    declaredTools: input.declaredTools,
    sideEffectLevel,
    hasHighRiskText,
    hasCriticalText
  });

  return {
    skillType: looksLikeEvidence && sideEffectLevel === "read_only" ? "evidence" : "execution",
    sideEffectLevel,
    defaultRiskLevel,
    warnings
  };
}

function sideEffectLevelFor(input: {
  hasCriticalText: boolean;
  hasHighRiskText: boolean;
  hasMutatingTools: boolean;
  hasReadOnlyTools: boolean;
  sourceType: SkillRegistrySourceType;
}): SkillRegistrySideEffectLevel {
  if (input.hasCriticalText || input.hasHighRiskText || input.hasMutatingTools) return "mutating";
  if (input.hasReadOnlyTools) return "read_only";
  if (input.sourceType === "mcp_tool" || input.sourceType === "native_connector") return "mutating";
  if (input.sourceType === "demo_fixture") return "simulated";
  if (input.sourceType === "codex_skill") return "simulated";
  return "read_only";
}

function riskLevelFor(
  sideEffectLevel: SkillRegistrySideEffectLevel,
  hasCriticalText: boolean,
  hasHighRiskText: boolean
): SkillRegistryRiskLevel {
  if (hasCriticalText) return "critical";
  if (hasHighRiskText) return "high";
  if (sideEffectLevel === "mutating") return "medium";
  if (sideEffectLevel === "simulated") return "medium";
  return "low";
}

function warningsFor(input: {
  declaredTools: string[];
  sideEffectLevel: SkillRegistrySideEffectLevel;
  hasHighRiskText: boolean;
  hasCriticalText: boolean;
}): string[] {
  const warnings: string[] = [];
  if (input.declaredTools.length === 0) warnings.push("No declared tool allowlist found; classification is inferred.");
  if (input.hasHighRiskText || input.hasCriticalText) warnings.push("High-risk language detected in skill content.");
  if (input.sideEffectLevel === "mutating") warnings.push("Mutating skill requires owner and policy review before enablement.");
  return warnings;
}
