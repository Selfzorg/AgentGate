import type { SkillRegistryCandidate } from "./types";

export type RegistryResolutionInput = {
  candidates: SkillRegistryCandidate[];
  rawAction: string;
  toolName?: string | undefined;
};

export type RegistryResolutionMatch = {
  candidate: SkillRegistryCandidate;
  confidence: number;
  matchedField: "skill_id" | "name" | "path" | "description";
};

export type RegistryResolutionResult = {
  selected: RegistryResolutionMatch | null;
  alternatives: RegistryResolutionMatch[];
};

export function resolveRegistryCandidate(input: RegistryResolutionInput): RegistryResolutionResult {
  const haystack = normalize([input.rawAction, input.toolName].filter(Boolean).join(" "));
  const haystackTokens = tokensFor(haystack);
  if (!haystack) {
    return {
      selected: null,
      alternatives: []
    };
  }

  const matches = input.candidates
    .flatMap((candidate) => matchCandidate(candidate, haystack, haystackTokens))
    .sort((left, right) => right.confidence - left.confidence || left.candidate.skillId.localeCompare(right.candidate.skillId));

  return {
    selected: matches[0] ?? null,
    alternatives: matches.slice(1, 4)
  };
}

function matchCandidate(candidate: SkillRegistryCandidate, haystack: string, haystackTokens: string[]): RegistryResolutionMatch[] {
  const matches: RegistryResolutionMatch[] = [];
  const skillId = normalize(candidate.skillId);
  const name = normalize(candidate.name);
  const pathIdentity = pathIdentityFor(candidate.relativePath);
  const description = normalize(candidate.description ?? "");

  if (skillId && tokenPhraseMatches(haystackTokens, tokensFor(skillId))) {
    matches.push({ candidate, confidence: 1, matchedField: "skill_id" });
  }
  if (name && tokenPhraseMatches(haystackTokens, tokensFor(name))) {
    matches.push({ candidate, confidence: 0.92, matchedField: "name" });
  }
  if (pathIdentity.length > 0 && tokenPhraseMatches(haystackTokens, pathIdentity)) {
    matches.push({ candidate, confidence: 0.82, matchedField: "path" });
  }

  const descriptionScore = tokenOverlapScore(haystack, description);
  if (descriptionScore >= 0.5) {
    matches.push({
      candidate,
      confidence: Math.min(0.8, 0.45 + descriptionScore / 2),
      matchedField: "description"
    });
  }

  return bestMatchPerCandidate(matches);
}

function bestMatchPerCandidate(matches: RegistryResolutionMatch[]): RegistryResolutionMatch[] {
  const best = matches.reduce<RegistryResolutionMatch | null>(
    (current, candidate) => (!current || candidate.confidence > current.confidence ? candidate : current),
    null
  );
  return best ? [best] : [];
}

function tokenOverlapScore(haystack: string, value: string): number {
  const valueTokens = meaningfulTokens(value);
  if (valueTokens.length === 0) return 0;
  const haystackTokens = new Set(meaningfulTokens(haystack));
  const matched = valueTokens.filter((token) => haystackTokens.has(token));
  return matched.length / valueTokens.length;
}

function meaningfulTokens(value: string): string[] {
  return [
    ...new Set(
      tokensFor(value)
        .filter((token) => token.length >= 4)
    )
  ];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFor(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean).map(canonicalToken);
}

function tokenPhraseMatches(haystackTokens: string[], needleTokens: string[]): boolean {
  if (needleTokens.length === 0 || haystackTokens.length < needleTokens.length) return false;

  for (let start = 0; start <= haystackTokens.length - needleTokens.length; start += 1) {
    if (needleTokens.every((token, offset) => haystackTokens[start + offset] === token)) return true;
  }

  return false;
}

function pathIdentityFor(relativePath: string): string[] {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/\.md$/i, "");
  const segments = normalizedPath.split("/").filter(Boolean);
  const withoutSkillFile = segments.at(-1)?.toLowerCase() === "skill" ? segments.slice(0, -1) : segments;
  const tail = withoutSkillFile.at(-1) ?? "";
  return tokensFor(tail);
}

function canonicalToken(token: string) {
  if (token === "prod") return "production";
  if (token === "deployment" || token === "deploying" || token === "deployed") return "deploy";
  return token;
}
