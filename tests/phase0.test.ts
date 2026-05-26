import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDemoFixtures } from "@agentgate/config-loader";

const repoRoot = process.cwd();

describe("Phase 0 foundation", () => {
  it("keeps demo actions fixture-backed", async () => {
    const fixtures = await loadDemoFixtures(join(repoRoot, "configs"));

    expect(fixtures.actions.actions).toHaveLength(7);
    expect(fixtures.actions.actions.map((action) => action.expected_decision)).toEqual(
      expect.arrayContaining(["ALLOW", "DENY", "REQUIRE_APPROVAL", "FORCE_DRY_RUN"])
    );
  });

  it("includes the DB-backed queue and SSE source-of-truth tables", async () => {
    const schema = await readFile(join(repoRoot, "prisma/schema.prisma"), "utf8");

    expect(schema).toContain("model SkillRun");
    expect(schema).toContain("model ExecutionLog");
    expect(schema).toContain("@@unique([skillRunId, sequence])");
    expect(schema).toContain("model AuditEvent");
  });
});
