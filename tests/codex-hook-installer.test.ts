import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type InstallerModule = {
  installCodexHook: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  mergeCodexHook: (settings: Record<string, unknown>) => Record<string, any>;
};

let installer: InstallerModule;
let tempDirs: string[] = [];

beforeAll(async () => {
  installer = (await import("../scripts/install-codex-hook.mjs")) as InstallerModule;
});

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("Codex hook installer", () => {
  it("merges the AgentGate hook without dropping existing hooks", () => {
    const merged = installer.mergeCodexHook({
      hooks: {
        PreToolUse: [
          {
            matcher: "Shell",
            hooks: [{ type: "command", command: "node existing-hook.mjs" }]
          }
        ],
        SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "node session.mjs" }] }]
      }
    });

    expect(merged.hooks.PreToolUse).toHaveLength(2);
    expect(JSON.stringify(merged)).toContain("node existing-hook.mjs");
    expect(JSON.stringify(merged)).toContain(".agentgate/hooks/codex-pretooluse.mjs");
    expect(merged.hooks.SessionStart).toHaveLength(1);
  });

  it("does not duplicate an existing AgentGate hook", () => {
    const once = installer.mergeCodexHook({});
    const twice = installer.mergeCodexHook(once);

    expect(twice.hooks.PreToolUse).toHaveLength(1);
  });

  it("creates a missing target from the project example", async () => {
    const dir = await makeTempDir();
    const target = join(dir, ".codex", "hooks.json");

    const result = await installer.installCodexHook({ target });
    const installed = JSON.parse(await readFile(target, "utf8"));

    expect(result.changed).toBe(true);
    expect(result.created).toBe(true);
    expect(installed.hooks.PreToolUse[0].hooks[0].command).toContain("codex-pretooluse.mjs");
  });

  it("preserves existing settings by writing a backup before merge", async () => {
    const dir = await makeTempDir();
    const target = join(dir, ".codex", "hooks.json");
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(
      target,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Shell", hooks: [{ type: "command", command: "node existing-hook.mjs" }] }]
        }
      }),
      "utf8"
    );

    const result = await installer.installCodexHook({ target });
    const installed = JSON.parse(await readFile(target, "utf8"));

    expect(result.changed).toBe(true);
    expect(existsSync(String(result.backupPath))).toBe(true);
    expect(installed.hooks.PreToolUse).toHaveLength(2);
    expect(JSON.stringify(installed)).toContain("node existing-hook.mjs");
  });

  it("does not write files in dry-run mode", async () => {
    const dir = await makeTempDir();
    const target = join(dir, ".codex", "hooks.json");

    const result = await installer.installCodexHook({ target, dryRun: true });

    expect(result.changed).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "agentgate-codex-hook-"));
  tempDirs.push(dir);
  return dir;
}
