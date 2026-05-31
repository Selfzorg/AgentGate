import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("isolated test runner harness", () => {
  it("does not use pooler-only query params for Prisma migration setup", async () => {
    const script = await readFile(join(process.cwd(), "scripts/run-tests-isolated.mjs"), "utf8");

    expect(script).toContain('parsed.searchParams.delete("pgbouncer")');
    expect(script).toContain('parsed.searchParams.delete("connection_limit")');
    expect(script).toContain('parsed.searchParams.delete("pool_timeout")');
    expect(script).toContain('parsed.searchParams.delete("statement_cache_size")');
  });
});
