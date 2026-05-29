import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRegistryCandidate, scanAgentSkills } from "@agentgate/skill-registry";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/api-server/src/app";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("skill registry scanner", () => {
  it("discovers Codex skills with stable source metadata and conservative risk classification", async () => {
    await withTempWorkspace(async (workspace) => {
      const skillDir = join(workspace, ".agents", "skills", "deploy-service");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        [
          "---",
          "name: Deploy Service",
          "description: Deploy checkout-api to production",
          "---",
          "",
          "Use this skill to run `vercel deploy --prod` after release checks pass."
        ].join("\n"),
        "utf8"
      );

      const scan = await scanAgentSkills({ rootDir: workspace });
      expect(scan.candidates).toHaveLength(1);
      expect(scan.candidates[0]).toMatchObject({
        skillId: "codex_skill:repo:agents-skills-deploy-service",
        name: "Deploy Service",
        sourceType: "codex_skill",
        scope: "repo",
        sideEffectLevel: "mutating",
        defaultRiskLevel: "high",
        allowedRuntimes: ["codex_cli", "codex_mcp"],
        preferredRuntimes: ["codex_cli"]
      });
      expect(scan.candidates[0]?.contentHash).toMatch(/^sha256:/);
      expect(scan.candidates[0]?.warnings).toEqual(
        expect.arrayContaining(["Mutating skill requires owner and policy review before enablement."])
      );
    });
  });

  it("discovers read-only Claude commands as evidence candidates", async () => {
    await withTempWorkspace(async (workspace) => {
      const commandDir = join(workspace, ".claude", "commands", "checks");
      await mkdir(commandDir, { recursive: true });
      await writeFile(
        join(commandDir, "verify-ci.md"),
        [
          "---",
          "description: Verify CI status for the current pull request",
          "allowed-tools: Read, Grep, Bash(git status:*)",
          "---",
          "",
          "Read existing CI metadata and return whether the latest checks passed."
        ].join("\n"),
        "utf8"
      );

      const scan = await scanAgentSkills({ rootDir: workspace });
      expect(scan.candidates).toHaveLength(1);
      expect(scan.candidates[0]).toMatchObject({
        skillId: "claude_command:repo:claude-commands-checks-verify-ci",
        name: "verify-ci",
        sourceType: "claude_command",
        skillType: "evidence",
        sideEffectLevel: "read_only",
        defaultRiskLevel: "low",
        declaredTools: ["Read", "Grep", "Bash(git status:*)"],
        allowedRuntimes: ["claude_cli", "claude_code_mcp", "local_deterministic"]
      });
    });
  });

  it("keeps invalid frontmatter non-fatal and visible for import review", async () => {
    await withTempWorkspace(async (workspace) => {
      const commandDir = join(workspace, ".claude", "commands");
      await mkdir(commandDir, { recursive: true });
      await writeFile(
        join(commandDir, "broken.md"),
        ["---", "description: [unterminated", "---", "Read repository state only."].join("\n"),
        "utf8"
      );

      const scan = await scanAgentSkills({ rootDir: workspace });
      expect(scan.candidates).toHaveLength(1);
      expect(scan.candidates[0]?.warnings).toContain("Invalid YAML frontmatter.");
      expect(scan.candidates[0]).toMatchObject({
        name: "broken",
        sourceType: "claude_command"
      });
    });
  });

  it("resolves actions against discovered registry candidates without requiring static matchers", async () => {
    await withTempWorkspace(async (workspace) => {
      const skillDir = join(workspace, ".agents", "skills", "prod-deploy");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        [
          "---",
          "name: Production Deploy",
          "description: Run vercel deployment to production",
          "---",
          "",
          "Deploy a release after all AgentGate evidence checks pass."
        ].join("\n"),
        "utf8"
      );

      const scan = await scanAgentSkills({ rootDir: workspace });
      const resolved = resolveRegistryCandidate({
        candidates: scan.candidates,
        rawAction: "please run vercel deploy --prod for checkout-api",
        toolName: "Bash"
      });

      expect(resolved.selected).toMatchObject({
        confidence: expect.any(Number),
        candidate: {
          skillId: "codex_skill:repo:agents-skills-prod-deploy"
        }
      });
      expect(["path", "description"]).toContain(resolved.selected?.matchedField);
      expect(resolved.selected?.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });

  it("does not match short path fragments inside unrelated action tokens", async () => {
    await withTempWorkspace(async (workspace) => {
      const commandDir = join(workspace, ".claude", "commands", "ecommerce");
      await mkdir(commandDir, { recursive: true });
      await writeFile(
        join(commandDir, "customer-opt-out.md"),
        [
          "---",
          "description: Handle consumer privacy request to opt out and erase personal information.",
          "allowed-tools: Bash(echo:*)",
          "---",
          "",
          "Opt out a customer from tracking."
        ].join("\n"),
        "utf8"
      );

      const scan = await scanAgentSkills({ rootDir: workspace });
      const resolved = resolveRegistryCandidate({
        candidates: scan.candidates,
        rawAction: 'vercel deploy --prod({"service":"checkout-api"})',
        toolName: "vercel deploy --prod"
      });

      expect(resolved.selected).toBeNull();
      expect(resolved.alternatives).toEqual([]);
    });
  });

  it("exposes a read-only registry scan endpoint", async () => {
    const app = await createApp({ prisma, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/registry/scan"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.scan.rootDir).toBe(process.cwd());
    expect(Array.isArray(body.scan.candidates)).toBe(true);
    expect(Array.isArray(body.scan.warnings)).toBe(true);

    await app.close();
  });
});

async function withTempWorkspace(test: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), "agentgate-skill-registry-"));
  try {
    await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
