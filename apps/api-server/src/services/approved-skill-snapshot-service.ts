import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseMarkdownFrontmatter } from "@agentgate/skill-registry";
import type { PrismaClient } from "@prisma/client";

const MAX_APPROVED_SKILL_BYTES = 256_000;

export type ApprovedSkillExecutionSnapshot = {
  version: "agentgate.skill_execution_snapshot.v1";
  format: "markdown";
  entrypointPath: string;
  sourcePath: string | null;
  entrypointContent: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sourceHash: string;
  entrypointContentHash: string;
  supportingFiles: Array<{ path: string; content_hash: string; size_bytes: number; content: string }>;
  warnings: string[];
};

export async function loadApprovedSkillExecutionSnapshot(
  prisma: PrismaClient,
  input: {
    skillVersionId: string;
    expectedSourceHash: string | null;
  }
): Promise<
  | { ok: true; snapshot: ApprovedSkillExecutionSnapshot }
  | { ok: false; status: 404 | 409; error: string }
> {
  const version = await prisma.skillVersion.findUnique({
    where: { id: input.skillVersionId }
  });

  if (!version) {
    return { ok: false, status: 404, error: "Approved skill version is no longer present in the registry" };
  }

  const config = recordFrom(version.config);
  const stored = snapshotFromConfig(config, input.expectedSourceHash);
  if (stored) return { ok: true, snapshot: stored };

  const truncatedStoredSnapshot = booleanFrom(recordFrom(config.execution_snapshot).truncated);
  if (truncatedStoredSnapshot) {
    return {
      ok: false,
      status: 409,
      error: "Approved skill body snapshot is truncated; re-import a smaller skill entrypoint before live Claude execution"
    };
  }

  return loadSnapshotFromApprovedSource(prisma, {
    skillVersionId: input.skillVersionId,
    config,
    expectedSourceHash: input.expectedSourceHash
  });
}

function snapshotFromConfig(config: Record<string, unknown>, expectedSourceHash: string | null): ApprovedSkillExecutionSnapshot | null {
  const snapshot = recordFrom(config.execution_snapshot);
  const entrypointContent = textFrom(snapshot.entrypoint_content);
  if (!entrypointContent || booleanFrom(snapshot.truncated)) return null;

  const parsed = parseMarkdownFrontmatter(entrypointContent);
  const body = textFrom(snapshot.body) ?? parsed.body;
  const source = recordFrom(config.source);
  const sourceHash = textFrom(snapshot.source_hash) ?? textFrom(source.content_hash) ?? expectedSourceHash ?? "";
  const entrypointContentHash = textFrom(snapshot.entrypoint_content_hash) ?? hashText(entrypointContent);

  if (expectedSourceHash && sourceHash !== expectedSourceHash) return null;

  return {
    version: "agentgate.skill_execution_snapshot.v1",
    format: "markdown",
    entrypointPath: textFrom(snapshot.entrypoint_path) ?? textFrom(source.path) ?? "unknown",
    sourcePath: null,
    entrypointContent,
    body,
    frontmatter: recordFrom(snapshot.frontmatter),
    sourceHash,
    entrypointContentHash,
    supportingFiles: supportingFilesFrom(snapshot.supporting_files),
    warnings: stringArray(config.import_warnings)
  };
}

async function loadSnapshotFromApprovedSource(
  prisma: PrismaClient,
  input: {
    skillVersionId: string;
    config: Record<string, unknown>;
    expectedSourceHash: string | null;
  }
): Promise<
  | { ok: true; snapshot: ApprovedSkillExecutionSnapshot }
  | { ok: false; status: 404 | 409; error: string }
> {
  const candidate = await prisma.skillImportCandidate.findFirst({
    where: { importedSkillVersionId: input.skillVersionId }
  });

  if (!candidate) {
    return {
      ok: false,
      status: 409,
      error: "Approved skill body is not stored and the original import candidate is unavailable; re-import is required"
    };
  }

  let entrypointContent: string;
  try {
    entrypointContent = await readFile(candidate.sourcePath, "utf8");
  } catch {
    return {
      ok: false,
      status: 409,
      error: "Approved skill body is not stored and the original source file is unavailable; re-import is required"
    };
  }

  if (Buffer.byteLength(entrypointContent, "utf8") > MAX_APPROVED_SKILL_BYTES) {
    return {
      ok: false,
      status: 409,
      error: "Approved skill source file is too large for live Claude execution; split the skill and re-import"
    };
  }

  const entrypointContentHash = hashText(entrypointContent);
  const metadata = recordFrom(input.config.metadata);
  const expectedEntrypointHash = textFrom(recordFrom(input.config.execution_snapshot).entrypoint_content_hash) ?? textFrom(metadata.content_file_hash);
  if (expectedEntrypointHash && entrypointContentHash !== expectedEntrypointHash) {
    return {
      ok: false,
      status: 409,
      error: "Approved skill source file changed after approval; re-import and re-approval are required"
    };
  }

  const parsed = parseMarkdownFrontmatter(entrypointContent);
  const source = recordFrom(input.config.source);

  return {
    ok: true,
    snapshot: {
      version: "agentgate.skill_execution_snapshot.v1",
      format: "markdown",
      entrypointPath: candidate.relativePath,
      sourcePath: candidate.sourcePath,
      entrypointContent,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      sourceHash: textFrom(source.content_hash) ?? input.expectedSourceHash ?? candidate.contentHash,
      entrypointContentHash,
      supportingFiles: [],
      warnings: stringArray(candidate.warnings)
    }
  };
}

function hashText(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textFrom(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanFrom(value: unknown) {
  return value === true;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function supportingFilesFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = recordFrom(entry);
    const path = textFrom(record.path);
    const contentHash = textFrom(record.content_hash);
    const content = textFrom(record.content);
    const sizeBytes = typeof record.size_bytes === "number" ? record.size_bytes : null;
    if (!path || !contentHash || content === null || sizeBytes === null) return [];
    return [{ path, content_hash: contentHash, size_bytes: sizeBytes, content }];
  });
}
