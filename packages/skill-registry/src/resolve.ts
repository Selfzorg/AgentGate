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
  if (!haystack) {
    return {
      selected: null,
      alternatives: []
    };
  }

  const matches = input.candidates
    .flatMap((candidate) => matchCandidate(candidate, haystack))
    .sort((left, right) => right.confidence - left.confidence || left.candidate.skillId.localeCompare(right.candidate.skillId));

  return {
    selected: matches[0] ?? null,
    alternatives: matches.slice(1, 4)
  };
}

function matchCandidate(candidate: SkillRegistryCandidate, haystack: string): RegistryResolutionMatch[] {
  const matches: RegistryResolutionMatch[] = [];
  const skillId = normalize(candidate.skillId);
  const name = normalize(candidate.name);
  const path = normalize(candidate.relativePath.replace(/\.md$/i, "").replace(/\/?skill$/i, ""));
  const description = normalize(candidate.description ?? "");

  if (skillId && haystack.includes(skillId)) {
    matches.push({ candidate, confidence: 1, matchedField: "skill_id" });
  }
  if (name && haystack.includes(name)) {
    matches.push({ candidate, confidence: 0.92, matchedField: "name" });
  }
  if (path && haystack.includes(lastSegment(path))) {
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
      normalize(value)
        .split(" ")
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

function lastSegment(value: string): string {
  const segments = value.split(" ").filter(Boolean);
  return segments.at(-1) ?? value;
}
