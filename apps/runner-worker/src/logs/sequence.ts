export function nextSequence(previous: number | undefined): number {
  return (previous ?? 0) + 1;
}
