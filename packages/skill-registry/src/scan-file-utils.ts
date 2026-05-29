import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export const ignoredDirectories = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);
export const maxMarkdownParseBytes = 1_000_000;
export const maxExecutionSnapshotBytes = 256_000;
const maxSupportingFileSnapshotBytes = 256_000;
const maxSingleSupportingFileSnapshotBytes = 64_000;
const maxSupportingFilesInMetadata = 100;

export async function directoryExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);
    return result.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch {
    return false;
  }
}

export async function collectFiles(rootDir: string, warnings: string[]): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.flatMap((entry) => {
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlink during skill scan: ${join(rootDir, entry.name)}`);
        return [];
      }
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
      const fullPath = join(rootDir, entry.name);
      return entry.isDirectory() ? [collectFiles(fullPath, warnings)] : [Promise.resolve([fullPath])];
    })
  );
  return nested.flat();
}

export async function hashSkillDirectory(
  skillDirectory: string,
  entryFile: string
): Promise<{
  contentHash: string;
  supportingFiles: string[];
  supportingFileCount: number;
  supportingFileBytes: number;
  supportingFileSnapshots: Array<{ path: string; content_hash: string; size_bytes: number; content: string }>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const files = (await collectFiles(skillDirectory, warnings)).sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  const supportingFiles: string[] = [];
  const supportingFileSnapshots: Array<{ path: string; content_hash: string; size_bytes: number; content: string }> = [];
  let supportingFileBytes = 0;
  let supportingSnapshotBytes = 0;

  for (const file of files) {
    const fileStat = await stat(file);
    const relativeFile = relative(skillDirectory, file);
    hash.update(`path:${relativeFile}\nsize:${fileStat.size}\n`);
    await updateHashFromFile(hash, file);
    hash.update("\n");

    if (file !== entryFile) {
      supportingFileBytes += fileStat.size;
      if (supportingFiles.length < maxSupportingFilesInMetadata) supportingFiles.push(relativeFile);
      if (
        fileStat.size <= maxSingleSupportingFileSnapshotBytes &&
        supportingSnapshotBytes + fileStat.size <= maxSupportingFileSnapshotBytes
      ) {
        const content = await readTextSupportingFile(file);
        if (content !== null) {
          supportingSnapshotBytes += fileStat.size;
          supportingFileSnapshots.push({
            path: relativeFile,
            content_hash: await hashFile(file),
            size_bytes: fileStat.size,
            content
          });
        }
      }
    }
  }

  if (files.length - 1 > maxSupportingFilesInMetadata) {
    warnings.push(`Supporting file metadata was truncated to ${maxSupportingFilesInMetadata} entries.`);
  }

  return {
    contentHash: `sha256:${hash.digest("hex")}`,
    supportingFiles,
    supportingFileCount: Math.max(files.length - 1, 0),
    supportingFileBytes,
    supportingFileSnapshots,
    warnings
  };
}

export async function readMarkdownForScan(file: string): Promise<{
  contentForParse: string;
  contentHash: string;
  truncated: boolean;
}> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let retainedBytes = 0;
    let truncated = false;
    const stream = createReadStream(file);

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      if (retainedBytes >= maxMarkdownParseBytes) {
        truncated = true;
        return;
      }

      const remaining = maxMarkdownParseBytes - retainedBytes;
      const retained = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      chunks.push(retained);
      retainedBytes += retained.length;
      if (buffer.length > remaining) truncated = true;
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolvePromise({
        contentForParse: Buffer.concat(chunks).toString("utf8"),
        contentHash: `sha256:${hash.digest("hex")}`,
        truncated
      });
    });
  });
}

export function executionSnapshotFor(input: {
  relativePath: string;
  markdown: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sourceHash: string;
  entrypointContentHash: string;
  sourceFileTruncated: boolean;
  supportingFiles: Array<{ path: string; content_hash: string; size_bytes: number; content: string }>;
}) {
  const markdown = limitTextByBytes(input.markdown, maxExecutionSnapshotBytes);
  const body = limitTextByBytes(input.body, maxExecutionSnapshotBytes);

  return {
    version: "agentgate.skill_execution_snapshot.v1",
    format: "markdown",
    entrypoint_path: input.relativePath,
    entrypoint_content: markdown.text,
    body: body.text,
    frontmatter: input.frontmatter,
    source_hash: input.sourceHash,
    entrypoint_content_hash: input.entrypointContentHash,
    supporting_files: input.supportingFiles,
    max_bytes: maxExecutionSnapshotBytes,
    truncated: input.sourceFileTruncated || markdown.truncated || body.truncated
  };
}

export function hashString(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function limitTextByBytes(text: string, maxBytes: number) {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return { text, truncated: false };
  return {
    text: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true
  };
}

async function readTextSupportingFile(file: string): Promise<string | null> {
  try {
    const content = await readFile(file, "utf8");
    return content.includes("\u0000") ? null : content;
  } catch {
    return null;
  }
}

async function hashFile(file: string) {
  const hash = createHash("sha256");
  await updateHashFromFile(hash, file);
  return `sha256:${hash.digest("hex")}`;
}

async function updateHashFromFile(hash: ReturnType<typeof createHash>, file: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
  });
}
