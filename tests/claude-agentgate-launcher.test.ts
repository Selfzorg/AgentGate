import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type LauncherModule = {
  buildClaudeArgs(extraArgs?: string[], root?: string): string[];
  buildClaudeEnv(env?: NodeJS.ProcessEnv, root?: string): NodeJS.ProcessEnv;
};

describe("AgentGate Claude launcher", () => {
  it("starts Claude in bare mode with explicit project settings", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentgate-claude-launcher-"));
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude", "settings.json"), "{}");
    writeFileSync(join(root, ".mcp.json"), "{}");
    writeFileSync(join(root, "CLAUDE.md"), "# AgentGate");

    const launcher = (await import("../scripts/claude-agentgate.mjs")) as LauncherModule;
    const args = launcher.buildClaudeArgs(["--print", "hello"], root);

    expect(args).toEqual([
      "--bare",
      "--add-dir",
      root,
      "--settings",
      join(root, ".claude", "settings.json"),
      "--mcp-config",
      join(root, ".mcp.json"),
      "--append-system-prompt-file",
      join(root, "CLAUDE.md"),
      "--print",
      "hello"
    ]);
  });

  it("starts project evidence workers with parallel defaults", async () => {
    const launcher = (await import("../scripts/claude-agentgate.mjs")) as LauncherModule;
    const env = launcher.buildClaudeEnv({
      PATH: "/bin"
    });

    expect(env).toMatchObject({
      PATH: "/bin",
      AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK: "4",
      AGENTGATE_EVIDENCE_AGENT_CONCURRENCY: "4",
      AGENTGATE_EVIDENCE_WORKER_CONCURRENCY: "4"
    });
  });

  it("does not override explicit evidence worker concurrency", async () => {
    const launcher = (await import("../scripts/claude-agentgate.mjs")) as LauncherModule;
    const env = launcher.buildClaudeEnv({
      AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK: "2",
      AGENTGATE_EVIDENCE_AGENT_CONCURRENCY: "2",
      AGENTGATE_EVIDENCE_WORKER_CONCURRENCY: "8"
    });

    expect(env).toMatchObject({
      AGENTGATE_EVIDENCE_AGENT_MAX_TASKS_PER_TICK: "2",
      AGENTGATE_EVIDENCE_AGENT_CONCURRENCY: "2",
      AGENTGATE_EVIDENCE_WORKER_CONCURRENCY: "8"
    });
  });

  it("loads local Claude model and provider environment overrides", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentgate-claude-launcher-"));
    mkdirSync(join(root, ".claude"));
    writeFileSync(
      join(root, ".claude", "settings.local.json"),
      JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        env: {
          ANTHROPIC_MODEL: "deepseek/deepseek-v4-flash",
          ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
          ANTHROPIC_AUTH_TOKEN: "test-token"
        }
      })
    );

    const launcher = (await import("../scripts/claude-agentgate.mjs")) as LauncherModule;
    const args = launcher.buildClaudeArgs([], root);
    const env = launcher.buildClaudeEnv({ ANTHROPIC_MODEL: "opus" }, root);

    expect(args).toEqual([
      "--bare",
      "--add-dir",
      root,
      "--model",
      "deepseek/deepseek-v4-flash"
    ]);
    expect(env).toMatchObject({
      ANTHROPIC_MODEL: "deepseek/deepseek-v4-flash",
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: "test-token"
    });
  });
});
