export function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolvedSkillId(snapshot: unknown): string {
  if (snapshot && typeof snapshot === "object" && "skill_id" in snapshot) {
    const value = (snapshot as { skill_id?: unknown }).skill_id;
    return typeof value === "string" ? value : "unknown";
  }
  return "unknown";
}

export function contextSummary(context: Record<string, unknown>) {
  return {
    repo: context.repo ?? null,
    service: context.service ?? null,
    environment: context.environment ?? null,
    branch: context.branch ?? null,
    target_branch: context.target_branch ?? null,
    database: context.database ?? null
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  requestedConcurrency: number | undefined,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const concurrency = Math.max(1, Math.min(Math.floor(requestedConcurrency ?? 1), Math.max(items.length, 1)));
  const results = new Array<R>(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await worker(items[currentIndex]!);
      }
    })
  );

  return results;
}
