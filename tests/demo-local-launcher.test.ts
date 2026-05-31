import { describe, expect, it } from "vitest";

type DemoLocalModule = {
  parseDemoLocalArgs: (
    args: string[],
    env?: Record<string, string | undefined>
  ) => { port: string; evidenceRuntime: string };
  selectEvidenceWorker: (input?: {
    requested?: string;
    env?: Record<string, string | undefined>;
    commandExists?: (command: string) => boolean;
  }) => {
    mode: string;
    runtimeLabel: string;
    reason: string;
    scriptArgs: string[] | null;
    env: Record<string, string>;
    error?: string;
  };
};

async function launcher() {
  return (await import("../scripts/demo-local.mjs")) as DemoLocalModule;
}

describe("demo local launcher", () => {
  it("parses port and evidence runtime overrides", async () => {
    const demoLocal = await launcher();

    expect(demoLocal.parseDemoLocalArgs(["--port", "3022", "--evidence-runtime", "claude"], {})).toEqual({
      port: "3022",
      evidenceRuntime: "claude"
    });
    expect(demoLocal.parseDemoLocalArgs(["--no-evidence-worker"], { WEB_PORT: "3010" })).toEqual({
      port: "3010",
      evidenceRuntime: "none"
    });
  });

  it("prefers Codex, then Claude, then local deterministic in auto mode", async () => {
    const demoLocal = await launcher();

    const codex = demoLocal.selectEvidenceWorker({
      requested: "auto",
      env: {},
      commandExists: (command) => command === "codex"
    });
    expect(codex.mode).toBe("codex");
    expect(codex.runtimeLabel).toBe("codex_cli");
    expect(codex.scriptArgs).toEqual(["evidence:claude-worker"]);
    expect(codex.env).toMatchObject({
      AGENTGATE_EVIDENCE_AGENT_DRIVER: "codex",
      AGENTGATE_EVIDENCE_AGENT_RUNTIME: "codex_cli",
      AGENTGATE_EVIDENCE_WORKER_AGENT_ID: "codex_demo_worker"
    });

    const claude = demoLocal.selectEvidenceWorker({
      requested: "auto",
      env: {},
      commandExists: (command) => command === "claude"
    });
    expect(claude.mode).toBe("claude");
    expect(claude.runtimeLabel).toBe("claude_code_mcp");

    const local = demoLocal.selectEvidenceWorker({
      requested: "auto",
      env: {},
      commandExists: () => false
    });
    expect(local.mode).toBe("local");
    expect(local.runtimeLabel).toBe("local_deterministic");
    expect(local.scriptArgs).toEqual(["evidence:worker"]);
  });

  it("fails explicit agent runtime selection when the CLI is not available", async () => {
    const demoLocal = await launcher();

    const codex = demoLocal.selectEvidenceWorker({
      requested: "codex",
      env: {},
      commandExists: () => false
    });

    expect(codex.error).toContain("codex CLI was not found");
  });
});
