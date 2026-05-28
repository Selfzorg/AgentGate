export function estimateTokens(input: string): number {
  return Math.max(1, Math.ceil(input.length / 4));
}

export function estimateCostCents(totalTokens: number): number {
  if (totalTokens <= 0) return 0;
  return Math.max(1, Math.ceil(totalTokens / 10_000));
}
