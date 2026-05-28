import { setTimeout as delay } from "node:timers/promises";

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const timeout = delay(timeoutMs).then(() => {
    throw new Error(message);
  });
  return Promise.race([promise, timeout]);
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

export function parseJsonLoose(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Evidence agent output did not contain JSON.");
    return JSON.parse(match[0]);
  }
}

export function splitCommand(value: string): string[] {
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}

export function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

export function isFalse(value: unknown): boolean {
  return ["0", "false", "no", "off"].includes(String(value ?? "").toLowerCase());
}

export function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
