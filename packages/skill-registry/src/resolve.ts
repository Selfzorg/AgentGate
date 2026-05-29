import type { SkillRegistryCandidate } from "./types";

export type RegistryResolutionInput = {
  candidates: SkillRegistryCandidate[];
  rawAction: string;
  toolName?: string | undefined;
};

export type RegistryResolutionMatch = {
  candidate: SkillRegistryCandidate;
  confidence: number;
  matchedField: "skill_id" | "name" | "path" | "declared_tool" | "description";
};

export type RegistryResolutionResult = {
  selected: RegistryResolutionMatch | null;
  alternatives: RegistryResolutionMatch[];
};

export function resolveRegistryCandidate(input: RegistryResolutionInput): RegistryResolutionResult {
  const haystack = normalize([input.rawAction, input.toolName].filter(Boolean).join(" agentgateboundary "));
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
  const declaredTools = candidate.declaredTools.flatMap((tool) => declaredToolIdentityFor(tool));

  if (skillId && tokenPhraseMatches(haystackTokens, tokensFor(skillId))) {
    matches.push({ candidate, confidence: 1, matchedField: "skill_id" });
  }
  if (name && tokenPhraseMatches(haystackTokens, tokensFor(name))) {
    matches.push({ candidate, confidence: 0.92, matchedField: "name" });
  } else if (name && unorderedTokensMatch(haystackTokens, tokensFor(name))) {
    matches.push({ candidate, confidence: 0.86, matchedField: "name" });
  }
  if (pathIdentity.length > 0 && tokenPhraseMatches(haystackTokens, pathIdentity)) {
    matches.push({ candidate, confidence: 0.82, matchedField: "path" });
  } else if (pathIdentity.length > 0 && unorderedTokensMatch(haystackTokens, pathIdentity)) {
    matches.push({ candidate, confidence: 0.78, matchedField: "path" });
  }
  if (declaredTools.some((toolTokens) => tokenPhraseMatches(haystackTokens, toolTokens))) {
    matches.push({ candidate, confidence: 0.88, matchedField: "declared_tool" });
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

function declaredToolIdentityFor(value: string): string[][] {
  const normalized = value
    .replace(/^[a-z]+\((.*)\)$/i, "$1")
    .replace(/[:*]+/g, " ");
  const tokens = tokensFor(normalized).filter((token) => token.length >= 3);
  if (tokens.length < 2) return [];
  return [tokens];
}

function unorderedTokensMatch(haystackTokens: string[], needleTokens: string[]): boolean {
  if (needleTokens.length < 2 || needleTokens.length > 4) return false;
  const haystack = new Set(haystackTokens);
  return [...new Set(needleTokens)].every((token) => haystack.has(token));
}

function canonicalToken(token: string) {
  if (token === "prod") return "production";
  if (token === "deployment" || token === "deploying" || token === "deployed") return "deploy";
  return token;
}
